"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { convertManyUtmToLatLon, convertManyLatLonToUtm } from "@/lib/utm";

export default function UploaderForm({ onParsed }) {
  const [zone, setZone] = useState(39);
  const [hemisphere, setHemisphere] = useState("north");
  const [projectInfo, setProjectInfo] = useState({
    location: "",
    employer: "",
    contractor: "",
    date: "",
    scale: "1:1000",
  });
  const [rawRows, setRawRows] = useState([]);
  const [mode, setMode] = useState("utm");
  const fileRef = useRef(null);
  const dxfFileRef = useRef(null);
  const [notice, setNotice] = useState("");
  const [rawType, setRawType] = useState(null); // 'utm' | 'wgs84'

  function parseText(text) {
    // Try CSV via Papa; fallback to whitespace/CSV lines (name-first or easting-first)
    const parsed = Papa.parse(String(text || "").trim(), { header: true, skipEmptyLines: true });
    let rows = [];
    if (parsed && parsed.data && parsed.data.length > 0 && parsed.meta && parsed.meta.fields && parsed.meta.fields.length) {
      rows = parsed.data
        .map((r, idx) => {
          const name = r.name || r.Name || r["Point name"] || r.point || r.Point || r.id || r.ID || `P${idx + 1}`;
          const e = Number(r.easting ?? r.Easting ?? r.EASTING ?? r.x ?? r.X ?? r.E ?? r.e ?? r.east ?? r.East);
          const n = Number(r.northing ?? r.Northing ?? r.NORTHING ?? r.y ?? r.Y ?? r.N ?? r.n ?? r.north ?? r.North);
          return { name, easting: e, northing: n };
        })
        .filter((r) => Number.isFinite(r.easting) && Number.isFinite(r.northing));
      setRawRows(rows);
      return rows;
    }

    // Headerless or irregular lines: support both "name,e,n" and "e,n,name"
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    rows = lines
      .map((line, idx) => {
        const parts = line.split(/[;,\s]+/).filter(Boolean);
        let name = `P${idx + 1}`;
        let e = Number(parts[0]);
        let n = Number(parts[1]);
        // Case: name first, then easting, northing
        if (!Number.isFinite(e) && Number.isFinite(Number(parts[1])) && Number.isFinite(Number(parts[2]))) {
          name = parts[0];
          e = Number(parts[1]);
          n = Number(parts[2]);
        } else {
          // Case: easting, northing, [name]
          if (parts[2] && isNaN(Number(parts[2]))) name = parts[2];
        }
        return { name, easting: e, northing: n };
      })
      .filter((r) => Number.isFinite(r.easting) && Number.isFinite(r.northing));
    setRawRows(rows);
    return rows;
  }

  function parseTextMode2(text) {
    const t = String(text || "").trim();
    if (!t) {
      setRawRows([]);
      return [];
    }
    const lines = t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let name = `P${i + 1}`;
      let easting = undefined;
      let northing = undefined;
      // Try key=value tokens first (E=..., N=..., X=..., Y=...)
      const kvParts = line.split(/[;,\s]+/).map((s) => s.trim()).filter(Boolean);
      for (const tok of kvParts) {
        const m = tok.match(/^([eEnNxX]|Easting|Northing|east|north)\s*[:=]\s*(-?\d+(?:\.\d+)?)/);
        if (m) {
          const key = m[1].toLowerCase();
          const val = Number(m[2]);
          if (key === 'e' || key === 'x' || key === 'east' || key === 'easting') easting = val;
          if (key === 'n' || key === 'y' || key === 'north' || key === 'northing') northing = val;
          continue;
        }
      }
      // If still missing, extract all numbers and pick two largest as UTM (northing>=easting)
      if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
        const nums = (line.match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => Number.isFinite(n));
        if (nums.length >= 2) {
          const sorted = nums.slice().sort((a, b) => b - a);
          const nVal = sorted[0];
          const eVal = sorted[1];
          // Basic sanity: swap if needed to keep northing >= easting
          northing = Math.max(nVal, eVal);
          easting = Math.min(nVal, eVal);
        }
      }
      // Try to infer name from tokens containing letters
      const word = kvParts.find((s) => /[A-Za-z\u0600-\u06FF]/.test(s) && !s.includes('=') && !s.includes(':'));
      if (word) name = word;
      if (Number.isFinite(easting) && Number.isFinite(northing)) {
        rows.push({ name, easting: Number(easting), northing: Number(northing) });
      }
    }
    setRawRows(rows);
    return rows;
  }

  function parseTextMode3(text) {
    const t = String(text || "").trim();
    if (!t) {
      setRawRows([]);
      return [];
    }
    
    // Parse CSV with header
    const parsed = Papa.parse(t, { header: true, skipEmptyLines: true });
    if (!parsed || !parsed.data || parsed.data.length === 0) {
      setRawRows([]);
      return [];
    }

    const allPoints = new Map(); // Use Map to handle duplicates by coordinates
    const lines = [];

    // Process each row to extract line information
    parsed.data.forEach((row) => {
      const name = row.name || row.Name || row["Point name"] || row.point || row.Point || row.id || row.ID || '';
      const easting = Number(row.easting ?? row.Easting ?? row.EASTING ?? row.x ?? row.X ?? row.E ?? row.e ?? row.east ?? row.East);
      const northing = Number(row.northing ?? row.Northing ?? row.NORTHING ?? row.y ?? row.Y ?? row.N ?? row.n ?? row.north ?? row.North);

      if (!Number.isFinite(easting) || !Number.isFinite(northing) || !name) return;

      // Extract line information from name (e.g., "ProjectName-L1-P1")
      const lineMatch = name.match(/(.+)-L(\d+)-P([12])$/i);
      if (lineMatch) {
        const [, baseName, lineNum, pointNum] = lineMatch;
        const lineId = `${baseName}-L${lineNum}`;
        
        if (!lines.find(l => l.id === lineId)) {
          lines.push({ id: lineId, points: [] });
        }
        
        const line = lines.find(l => l.id === lineId);
        line.points.push({
          name,
          easting,
          northing,
          pointNum: parseInt(pointNum),
          originalIndex: parsed.data.indexOf(row)
        });
      }

      // Add to unique points map (key by coordinates to handle duplicates)
      const coordKey = `${easting.toFixed(3)},${northing.toFixed(3)}`;
      if (!allPoints.has(coordKey)) {
        allPoints.set(coordKey, { name, easting, northing });
      }
    });

    // Sort line points and extract unique boundary points
    const boundaryPoints = [];
    const processedCoords = new Set();

    lines.forEach(line => {
      // Sort points within each line (P1 first, then P2)
      line.points.sort((a, b) => a.pointNum - b.pointNum);
      
      line.points.forEach(point => {
        const coordKey = `${point.easting.toFixed(3)},${point.northing.toFixed(3)}`;
        if (!processedCoords.has(coordKey)) {
          processedCoords.add(coordKey);
          boundaryPoints.push({
            name: point.name,
            easting: point.easting,
            northing: point.northing
          });
        }
      });
    });

    // If we have lines, try to create a polygon boundary
    if (lines.length > 0) {
      // Simple approach: use all unique points
      setRawRows(boundaryPoints);
      return boundaryPoints;
    }

    // Fallback: use all unique points
    const uniquePoints = Array.from(allPoints.values());
    setRawRows(uniquePoints);
    return uniquePoints;
  }

  function parseTextMode4(text) {
    const t = String(text || "").trim();
    if (!t) {
      setRawRows([]);
      return [];
    }
    
    // Parse CSV with header
    const parsed = Papa.parse(t, { header: true, skipEmptyLines: true });
    if (!parsed || !parsed.data || parsed.data.length === 0) {
      setRawRows([]);
      return [];
    }

    const allPoints = [];

    // Process each row
    parsed.data.forEach((row) => {
      const name = row.name || row.Name || row["Point name"] || row.point || row.Point || row.id || row.ID || '';
      const easting = Number(row.easting ?? row.Easting ?? row.EASTING ?? row.x ?? row.X ?? row.E ?? row.e ?? row.east ?? row.East);
      const northing = Number(row.northing ?? row.Northing ?? row.NORTHING ?? row.y ?? row.Y ?? row.N ?? row.n ?? row.north ?? row.North);

      if (!Number.isFinite(easting) || !Number.isFinite(northing) || !name) return;

      allPoints.push({ name, easting, northing });
    });

    // Remove exact duplicates by coordinates
    const uniquePoints = [];
    const seenCoords = new Set();
    
    allPoints.forEach(point => {
      const coordKey = `${point.easting.toFixed(3)},${point.northing.toFixed(3)}`;
      if (!seenCoords.has(coordKey)) {
        seenCoords.add(coordKey);
        uniquePoints.push(point);
      }
    });

    // Group points into clusters by proximity (within 1000m)
    const pointClusters = [];
    const processed = new Set();

    uniquePoints.forEach((point, index) => {
      if (processed.has(index)) return;

      const cluster = [point];
      processed.add(index);

      // Find nearby points
      uniquePoints.forEach((otherPoint, otherIndex) => {
        if (processed.has(otherIndex)) return;
        
        const distance = Math.sqrt(
          Math.pow(point.easting - otherPoint.easting, 2) + 
          Math.pow(point.northing - otherPoint.northing, 2)
        );

        if (distance < 1000) { // Within 1km
          cluster.push(otherPoint);
          processed.add(otherIndex);
        }
      });

      if (cluster.length >= 3) { // Only keep clusters with 3+ points
        pointClusters.push(cluster);
      }
    });

    // Choose the largest cluster
    const largestCluster = pointClusters.sort((a, b) => b.length - a.length)[0] || uniquePoints;

    // Sort points in clockwise order to form a proper polygon
    const sortedPoints = sortPointsClockwise(largestCluster);

    setRawRows(sortedPoints);
    return sortedPoints;
  }

  function sortPointsClockwise(points) {
    if (points.length < 3) return points;

    // Find centroid
    const centroid = {
      easting: points.reduce((sum, p) => sum + p.easting, 0) / points.length,
      northing: points.reduce((sum, p) => sum + p.northing, 0) / points.length
    };

    // Calculate angle from centroid for each point
    const pointsWithAngles = points.map(point => ({
      ...point,
      angle: Math.atan2(point.northing - centroid.northing, point.easting - centroid.easting)
    }));

    // Sort by angle (clockwise)
    pointsWithAngles.sort((a, b) => a.angle - b.angle);

    // Return points without angle property
    return pointsWithAngles.map(({ angle, ...point }) => point);
  }

  function parseTextMode5(text) {
    const t = String(text || "").trim();
    if (!t) {
      setRawRows([]);
      return [];
    }
    
    // Parse CSV with header
    const parsed = Papa.parse(t, { header: true, skipEmptyLines: true });
    if (!parsed || !parsed.data || parsed.data.length === 0) {
      setRawRows([]);
      return [];
    }

    const allPoints = [];
    const lines = new Map(); // Map of line ID to line data

    // Step 1: Process all rows and extract line information
    parsed.data.forEach((row) => {
      const name = row.name || row.Name || row["Point name"] || row.point || row.Point || row.id || row.ID || '';
      const easting = Number(row.easting ?? row.Easting ?? row.EASTING ?? row.x ?? row.X ?? row.E ?? row.e ?? row.east ?? row.East);
      const northing = Number(row.northing ?? row.Northing ?? row.NORTHING ?? row.y ?? row.Y ?? row.N ?? row.n ?? row.north ?? row.North);

      if (!Number.isFinite(easting) || !Number.isFinite(northing) || !name) return;

      const point = { name, easting, northing };
      allPoints.push(point);

      // Extract line information from name pattern: ProjectName-L##-P#
      const lineMatch = name.match(/(.+)-L(\d+)-P([12])$/i);
      if (lineMatch) {
        const [, baseName, lineNum, pointNum] = lineMatch;
        const lineId = `${baseName}-L${lineNum}`;
        
        if (!lines.has(lineId)) {
          lines.set(lineId, { id: lineId, points: [], baseName });
        }
        
        const line = lines.get(lineId);
        line.points.push({
          ...point,
          pointNum: parseInt(pointNum),
          originalIndex: parsed.data.indexOf(row)
        });
      }
    });

    // Step 2: Remove duplicate points (within 0.1m tolerance)
    const uniquePoints = removeDuplicatePoints(allPoints, 0.1);

    // Step 3: Detect clusters/regions
    const clusters = detectPointClusters(uniquePoints, 300); // 300m clustering distance

    // Step 4: Choose the largest meaningful cluster
    const targetCluster = selectBestCluster(clusters, uniquePoints);

    // Step 5: Build boundary using line connectivity + advanced algorithms
    const boundaryPoints = buildOptimalBoundary(targetCluster, lines);

    setRawRows(boundaryPoints);
    return boundaryPoints;
  }

  function removeDuplicatePoints(points, tolerance = 0.1) {
    const unique = [];
    const processed = new Set();

    points.forEach((point, index) => {
      if (processed.has(index)) return;

      // Find all points within tolerance
      const duplicates = [index];
      for (let i = index + 1; i < points.length; i++) {
        if (processed.has(i)) continue;
        
        const other = points[i];
        const distance = Math.sqrt(
          Math.pow(point.easting - other.easting, 2) + 
          Math.pow(point.northing - other.northing, 2)
        );

        if (distance <= tolerance) {
          duplicates.push(i);
        }
      }

      // Mark all duplicates as processed
      duplicates.forEach(idx => processed.add(idx));

      // Keep the point with the most descriptive name (prefer non-pnt names)
      const bestPoint = duplicates
        .map(idx => points[idx])
        .sort((a, b) => {
          // Prefer points that are part of lines (have L##-P# pattern)
          const aHasLine = /-L\d+-P[12]$/i.test(a.name);
          const bHasLine = /-L\d+-P[12]$/i.test(b.name);
          if (aHasLine && !bHasLine) return -1;
          if (!aHasLine && bHasLine) return 1;
          
          // Prefer longer, more descriptive names
          return b.name.length - a.name.length;
        })[0];

      unique.push(bestPoint);
    });

    return unique;
  }

  function detectPointClusters(points, maxDistance) {
    const clusters = [];
    const processed = new Set();

    points.forEach((point, index) => {
      if (processed.has(index)) return;

      const cluster = [point];
      processed.add(index);

      // Find all points within maxDistance
      points.forEach((otherPoint, otherIndex) => {
        if (processed.has(otherIndex)) return;
        
        const distance = Math.sqrt(
          Math.pow(point.easting - otherPoint.easting, 2) + 
          Math.pow(point.northing - otherPoint.northing, 2)
        );

        if (distance <= maxDistance) {
          cluster.push(otherPoint);
          processed.add(otherIndex);
        }
      });

      if (cluster.length >= 3) {
        clusters.push(cluster);
      }
    });

    return clusters;
  }

  function selectBestCluster(clusters, allPoints) {
    if (clusters.length === 0) {
      return allPoints.length >= 3 ? allPoints : [];
    }

    // Score clusters based on size and line connectivity
    const scoredClusters = clusters.map(cluster => {
      const linePoints = cluster.filter(p => /-L\d+-P[12]$/i.test(p.name));
      const score = cluster.length + (linePoints.length * 0.5); // Bonus for line points
      return { cluster, score };
    });

    // Return the highest scoring cluster
    return scoredClusters.sort((a, b) => b.score - a.score)[0].cluster;
  }

  function buildOptimalBoundary(points, lines) {
    if (points.length < 3) return points;

    // Try line-based boundary construction first
    const lineBoundary = constructBoundaryFromLines(points, lines);
    if (lineBoundary && lineBoundary.length >= 3) {
      return lineBoundary;
    }

    // Fallback to geometric boundary detection
    return constructGeometricBoundary(points);
  }

  function constructBoundaryFromLines(points, lines) {
    const relevantLines = Array.from(lines.values()).filter(line => {
      // Only include lines that have points in our target cluster
      return line.points.some(linePoint => 
        points.some(clusterPoint => 
          Math.abs(linePoint.easting - clusterPoint.easting) < 1 &&
          Math.abs(linePoint.northing - clusterPoint.northing) < 1
        )
      );
    });

    if (relevantLines.length < 2) return null;

    // Build point connectivity graph
    const connections = new Map();
    const pointIndex = new Map();

    relevantLines.forEach(line => {
      if (line.points.length >= 2) {
        // Sort line points by pointNum (P1 before P2)
        line.points.sort((a, b) => a.pointNum - b.pointNum);
        
        const p1 = line.points[0];
        const p2 = line.points[line.points.length - 1];
        
        const key1 = `${p1.easting.toFixed(2)},${p1.northing.toFixed(2)}`;
        const key2 = `${p2.easting.toFixed(2)},${p2.northing.toFixed(2)}`;
        
        pointIndex.set(key1, p1);
        pointIndex.set(key2, p2);
        
        // Add bidirectional connections
        if (!connections.has(key1)) connections.set(key1, new Set());
        if (!connections.has(key2)) connections.set(key2, new Set());
        
        connections.get(key1).add(key2);
        connections.get(key2).add(key1);
      }
    });

    // Find the longest connected path that forms a boundary
    return findBoundaryPath(connections, pointIndex);
  }

  function findBoundaryPath(connections, pointIndex) {
    const allKeys = Array.from(connections.keys());
    if (allKeys.length < 3) return null;

    // Find corner points (points with fewer connections - likely boundary corners)
    const cornerPoints = allKeys.filter(key => connections.get(key).size <= 2);
    
    let bestPath = [];

    // Try starting from corner points first
    const startPoints = cornerPoints.length > 0 ? cornerPoints : allKeys.slice(0, 3);

    startPoints.forEach(startKey => {
      const path = traceBoundaryPath(startKey, connections, pointIndex);
      if (path.length > bestPath.length) {
        bestPath = path;
      }
    });

    return bestPath.length >= 3 ? bestPath : null;
  }

  function traceBoundaryPath(startKey, connections, pointIndex) {
    const path = [];
    const visited = new Set();
    let currentKey = startKey;

    while (currentKey && !visited.has(currentKey)) {
      path.push(pointIndex.get(currentKey));
      visited.add(currentKey);

      const neighbors = Array.from(connections.get(currentKey) || []);
      const unvisited = neighbors.filter(n => !visited.has(n));

      if (unvisited.length === 0) break;

      // Choose next point based on geometric criteria
      if (path.length >= 2 && unvisited.length > 1) {
        currentKey = chooseBestNextPoint(path, unvisited, pointIndex);
      } else {
        currentKey = unvisited[0];
      }
    }

    return path;
  }

  function chooseBestNextPoint(path, candidates, pointIndex) {
    if (candidates.length === 1) return candidates[0];

    const current = path[path.length - 1];
    const previous = path[path.length - 2];

    // Calculate the direction vector from previous to current
    const currentDir = {
      x: current.easting - previous.easting,
      y: current.northing - previous.northing
    };

    // Choose the candidate that maintains the most consistent direction (smallest turn angle)
    return candidates.reduce((best, candidate) => {
      const candidatePoint = pointIndex.get(candidate);
      const bestPoint = pointIndex.get(best);

      const candidateDir = {
        x: candidatePoint.easting - current.easting,
        y: candidatePoint.northing - current.northing
      };

      const bestDir = {
        x: bestPoint.easting - current.easting,
        y: bestPoint.northing - current.northing
      };

      const candidateAngle = Math.abs(calculateAngleDifference(currentDir, candidateDir));
      const bestAngle = Math.abs(calculateAngleDifference(currentDir, bestDir));

      return candidateAngle < bestAngle ? candidate : best;
    });
  }

  function calculateAngleDifference(v1, v2) {
    const angle1 = Math.atan2(v1.y, v1.x);
    const angle2 = Math.atan2(v2.y, v2.x);
    let diff = angle2 - angle1;
    
    // Normalize to [-π, π]
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    
    return diff;
  }

  function constructGeometricBoundary(points) {
    // Use concave hull algorithm for better boundary detection
    return concaveHull(points, 3); // k=3 for concave hull
  }

  function concaveHull(points, k) {
    if (points.length < 3) return points;
    if (points.length <= k) return sortPointsClockwise(points);

    // Find the starting point (leftmost, then bottommost)
    let start = points.reduce((min, p) => {
      if (p.easting < min.easting) return p;
      if (p.easting === min.easting && p.northing < min.northing) return p;
      return min;
    });

    const hull = [start];
    let current = start;
    let step = 2;

    while ((step === 2 || !pointsEqual(current, start)) && hull.length < points.length) {
      if (step === 5) {
        // If we can't close the hull, fall back to convex hull
        return sortPointsClockwise(points);
      }

      const kNearestPoints = findKNearestPoints(current, points.filter(p => !pointsEqual(p, current)), k);
      
      let cPoints = kNearestPoints.sort((a, b) => {
        const angleA = Math.atan2(a.northing - current.northing, a.easting - current.easting);
        const angleB = Math.atan2(b.northing - current.northing, b.easting - current.easting);
        return angleA - angleB;
      });

      let its = true;
      let i = -1;

      while (its && i < cPoints.length - 1) {
        i++;
        let lastPoint = hull.length > 1 ? hull[hull.length - 2] : null;
        
        if (lastPoint && pointsEqual(cPoints[i], lastPoint)) {
          continue;
        }

        let j = 1;
        its = false;

        while (j < hull.length - 1) {
          if (intersects(hull[j], hull[j + 1], current, cPoints[i])) {
            its = true;
            break;
          }
          j++;
        }
      }

      if (its) {
        return sortPointsClockwise(points);
      }

      current = cPoints[i];
      hull.push(current);
      step++;
    }

    return hull.length >= 3 ? hull : sortPointsClockwise(points);
  }

  function findKNearestPoints(point, candidates, k) {
    return candidates
      .map(p => ({
        ...p,
        distance: Math.sqrt(Math.pow(p.easting - point.easting, 2) + Math.pow(p.northing - point.northing, 2))
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k)
      .map(({ distance, ...p }) => p);
  }

  function pointsEqual(p1, p2) {
    return Math.abs(p1.easting - p2.easting) < 0.01 && Math.abs(p1.northing - p2.northing) < 0.01;
  }

  function intersects(p1, p2, p3, p4) {
    const ccw = (A, B, C) => (C.northing - A.northing) * (B.easting - A.easting) > (B.northing - A.northing) * (C.easting - A.easting);
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
  }

  function parseTextMode6(text) {
    const t = String(text || "").trim();
    if (!t) {
      setRawRows([]);
      return [];
    }
    
    // Parse CSV with header
    const parsed = Papa.parse(t, { header: true, skipEmptyLines: true });
    if (!parsed || !parsed.data || parsed.data.length === 0) {
      setRawRows([]);
      return [];
    }

    // MODE 6 - Professional Processing
    const config = {
      crs: "EPSG:32639",
      duplicate_tolerance_m: 0.01,
      cluster_eps_m: 25.0,
      min_polygon_vertices: 3
    };

    const results = processMode6Data(parsed.data, config);
    
    // Return the best polygon for display
    const bestPolygon = selectBestPolygonForDisplay(results);
    
    setRawRows(bestPolygon);
    
    // Store results for download
    window.mode6Results = results;
    
    return bestPolygon;
  }

  function processMode6Data(rawData, config) {
    const results = {
      all_points: [],
      duplicates_mapping: [],
      clusters_summary: [],
      lines: [],
      polygons: [],
      validation_report: [],
      summary: {
        total_points: rawData.length,
        crs: config.crs,
        warnings: [],
        methods_used: []
      }
    };

    // Step 1: Read and clean data
    const cleanedData = rawData.map((row, index) => {
      const name = String(row.name || row.Name || row["Point name"] || row.point || row.Point || row.id || row.ID || `P${index + 1}`).trim();
      const easting = Number(row.easting ?? row.Easting ?? row.EASTING ?? row.x ?? row.X ?? row.E ?? row.e ?? row.east ?? row.East);
      const northing = Number(row.northing ?? row.Northing ?? row.NORTHING ?? row.y ?? row.Y ?? row.N ?? row.n ?? row.north ?? row.North);
      const code = String(row.code || row.Code || '').trim();
      const description = String(row.description || row.Description || '').trim();

      return {
        id: index,
        name,
        easting,
        northing,
        code,
        description,
        valid: Number.isFinite(easting) && Number.isFinite(northing)
      };
    }).filter(point => point.valid);

    results.all_points = cleanedData;
    results.summary.valid_points = cleanedData.length;

    // Step 2: Detect duplicates
    const duplicateInfo = detectDuplicates(cleanedData, config.duplicate_tolerance_m);
    results.duplicates_mapping = duplicateInfo.mapping;
    results.summary.duplicate_clusters = duplicateInfo.clusters.length;

    // Step 3: DBSCAN Clustering
    const clusters = performDBSCAN(cleanedData, config.cluster_eps_m);
    results.clusters_summary = clusters.summary;
    results.summary.spatial_clusters = clusters.clusters.length;

    // Step 4: Polyline detection
    const polylines = detectPolylines(cleanedData);
    results.lines = polylines;
    results.summary.polylines_detected = polylines.length;

    // Step 5: Polygon construction per cluster
    clusters.clusters.forEach(cluster => {
      if (cluster.points.length >= config.min_polygon_vertices) {
        const polygon = constructPolygon(cluster.points, cluster.id);
        if (polygon) {
          results.polygons.push(polygon);
        }
      }
    });

    // Step 6: Validation
    results.polygons.forEach(polygon => {
      const validation = validatePolygon(polygon);
      results.validation_report.push(validation);
      if (!validation.valid) {
        results.summary.warnings.push(`Polygon ${polygon.cluster_id}: ${validation.issues.join(', ')}`);
      }
    });

    results.summary.methods_used = [
      'DBSCAN clustering',
      'Duplicate detection',
      'Polyline extraction',
      'Polygon construction',
      'Geometric validation'
    ];

    return results;
  }

  function detectDuplicates(points, tolerance) {
    const clusters = [];
    const mapping = [];
    const processed = new Set();

    points.forEach((point, index) => {
      if (processed.has(index)) return;

      const duplicateGroup = [point];
      processed.add(index);

      // Find all points within tolerance
      points.forEach((otherPoint, otherIndex) => {
        if (processed.has(otherIndex)) return;
        
        const distance = Math.sqrt(
          Math.pow(point.easting - otherPoint.easting, 2) + 
          Math.pow(point.northing - otherPoint.northing, 2)
        );

        if (distance <= tolerance) {
          duplicateGroup.push(otherPoint);
          processed.add(otherIndex);
        }
      });

      if (duplicateGroup.length > 1) {
        const clusterId = clusters.length;
        clusters.push(duplicateGroup);
        
        const kept = duplicateGroup[0];
        const duplicates = duplicateGroup.slice(1);
        
        duplicates.forEach(dup => {
          mapping.push({
            cluster_id: clusterId,
            kept_point: kept.name,
            duplicate_point: dup.name,
            dx: Math.abs(kept.easting - dup.easting),
            dy: Math.abs(kept.northing - dup.northing)
          });
        });
      }
    });

    return { clusters, mapping };
  }

  function performDBSCAN(points, eps) {
    const clusters = [];
    const visited = new Set();
    const clustered = new Set();

    function regionQuery(pointIndex) {
      const neighbors = [];
      const point = points[pointIndex];
      
      points.forEach((otherPoint, otherIndex) => {
        if (pointIndex === otherIndex) return;
        
        const distance = Math.sqrt(
          Math.pow(point.easting - otherPoint.easting, 2) + 
          Math.pow(point.northing - otherPoint.northing, 2)
        );
        
        if (distance <= eps) {
          neighbors.push(otherIndex);
        }
      });
      
      return neighbors;
    }

    function expandCluster(pointIndex, neighbors, clusterId) {
      const cluster = { id: clusterId, points: [points[pointIndex]] };
      clustered.add(pointIndex);
      
      let i = 0;
      while (i < neighbors.length) {
        const neighborIndex = neighbors[i];
        
        if (!visited.has(neighborIndex)) {
          visited.add(neighborIndex);
          const neighborNeighbors = regionQuery(neighborIndex);
          
          if (neighborNeighbors.length >= 1) { // min_samples = 1 for our use case
            neighbors.push(...neighborNeighbors.filter(n => !neighbors.includes(n)));
          }
        }
        
        if (!clustered.has(neighborIndex)) {
          cluster.points.push(points[neighborIndex]);
          clustered.add(neighborIndex);
        }
        
        i++;
      }
      
      return cluster;
    }

    let clusterId = 0;
    
    points.forEach((point, index) => {
      if (visited.has(index)) return;
      
      visited.add(index);
      const neighbors = regionQuery(index);
      
      if (neighbors.length >= 1) { // min_samples = 1
        const cluster = expandCluster(index, neighbors, clusterId++);
        clusters.push(cluster);
      } else {
        // Noise point becomes its own cluster
        clusters.push({ id: clusterId++, points: [point] });
      }
    });

    // Generate summary
    const summary = clusters.map(cluster => {
      const eastings = cluster.points.map(p => p.easting);
      const northings = cluster.points.map(p => p.northing);
      
      return {
        cluster_id: cluster.id,
        number_of_points: cluster.points.length,
        bounding_box: {
          min_easting: Math.min(...eastings),
          max_easting: Math.max(...eastings),
          min_northing: Math.min(...northings),
          max_northing: Math.max(...northings)
        }
      };
    });

    return { clusters, summary };
  }

  function detectPolylines(points) {
    const lineGroups = new Map();
    
    points.forEach(point => {
      // Look for pattern: prefix-P<digit>
      const match = point.name.match(/^(.+)-P(\d+)$/i);
      if (match) {
        const [, prefix, digit] = match;
        
        if (!lineGroups.has(prefix)) {
          lineGroups.set(prefix, []);
        }
        
        lineGroups.get(prefix).push({
          ...point,
          sequence: parseInt(digit)
        });
      }
    });

    const polylines = [];
    
    lineGroups.forEach((linePoints, prefix) => {
      if (linePoints.length >= 2) {
        // Sort by sequence number
        linePoints.sort((a, b) => a.sequence - b.sequence);
        
        polylines.push({
          id: prefix,
          points: linePoints,
          type: 'polyline'
        });
      }
    });

    return polylines;
  }

  function constructPolygon(clusterPoints, clusterId) {
    if (clusterPoints.length < 3) return null;

    let orderedPoints;

    // Method 1: Check for numeric suffix (pnt001, pnt002, etc.)
    const numericPattern = /(\d+)$/;
    const hasNumericSuffix = clusterPoints.every(p => numericPattern.test(p.name));
    
    if (hasNumericSuffix) {
      orderedPoints = [...clusterPoints].sort((a, b) => {
        const aNum = parseInt(a.name.match(numericPattern)[1]);
        const bNum = parseInt(b.name.match(numericPattern)[1]);
        return aNum - bNum;
      });
    } else {
      // Method 2: Sort by polar angle from centroid
      const centroid = {
        easting: clusterPoints.reduce((sum, p) => sum + p.easting, 0) / clusterPoints.length,
        northing: clusterPoints.reduce((sum, p) => sum + p.northing, 0) / clusterPoints.length
      };

      orderedPoints = [...clusterPoints].sort((a, b) => {
        const angleA = Math.atan2(a.northing - centroid.northing, a.easting - centroid.easting);
        const angleB = Math.atan2(b.northing - centroid.northing, b.easting - centroid.easting);
        return angleA - angleB;
      });
    }

    // Check for self-intersection
    if (hasSelfintersection(orderedPoints)) {
      // Fallback to convex hull
      orderedPoints = computeConvexHull(clusterPoints);
    }

    // Close polygon by repeating first point
    const closedPolygon = [...orderedPoints, orderedPoints[0]];

    return {
      cluster_id: clusterId,
      points: closedPolygon,
      method: hasNumericSuffix ? 'numeric_sort' : 'polar_angle',
      type: 'polygon'
    };
  }

  function hasSelfintersection(points) {
    if (points.length < 4) return false;

    for (let i = 0; i < points.length; i++) {
      for (let j = i + 2; j < points.length; j++) {
        if (i === 0 && j === points.length - 1) continue; // Skip adjacent edges
        
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        const p3 = points[j];
        const p4 = points[(j + 1) % points.length];
        
        if (intersects(p1, p2, p3, p4)) {
          return true;
        }
      }
    }
    return false;
  }

  function computeConvexHull(points) {
    if (points.length < 3) return points;
    
    // Graham scan algorithm
    const sorted = [...points].sort((a, b) => {
      if (a.easting !== b.easting) return a.easting - b.easting;
      return a.northing - b.northing;
    });
    
    const cross = (o, a, b) => {
      return (a.easting - o.easting) * (b.northing - o.northing) - 
             (a.northing - o.northing) * (b.easting - o.easting);
    };
    
    // Build lower hull
    const lower = [];
    for (const point of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
        lower.pop();
      }
      lower.push(point);
    }
    
    // Build upper hull
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const point = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
        upper.pop();
      }
      upper.push(point);
    }
    
    // Remove last point of each half because it's repeated
    lower.pop();
    upper.pop();
    
    return lower.concat(upper);
  }

  function validatePolygon(polygon) {
    const validation = {
      cluster_id: polygon.cluster_id,
      valid: true,
      issues: [],
      area: 0,
      orientation: 'unknown'
    };

    const points = polygon.points.slice(0, -1); // Remove duplicate last point for calculation

    // Calculate area using shoelace formula
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].easting * points[j].northing;
      area -= points[j].easting * points[i].northing;
    }
    area = Math.abs(area) / 2;
    validation.area = area;

    // Check orientation
    validation.orientation = area > 0 ? 'counterclockwise' : 'clockwise';

    // Check for minimum area
    if (area < 1) { // Less than 1 square meter
      validation.valid = false;
      validation.issues.push('Area too small');
    }

    // Check for self-intersection
    if (hasSelfintersection(points)) {
      validation.valid = false;
      validation.issues.push('Self-intersection detected');
    }

    // Check for minimum vertices
    if (points.length < 3) {
      validation.valid = false;
      validation.issues.push('Insufficient vertices');
    }

    return validation;
  }

  function selectBestPolygonForDisplay(results) {
    if (results.polygons.length === 0) {
      // Fallback: return all points sorted by name
      return results.all_points.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Select the largest valid polygon
    const validPolygons = results.polygons.filter(p => {
      const validation = results.validation_report.find(v => v.cluster_id === p.cluster_id);
      return validation && validation.valid;
    });

    if (validPolygons.length === 0) {
      // Return the largest polygon even if invalid
      const largestPolygon = results.polygons.sort((a, b) => b.points.length - a.points.length)[0];
      return largestPolygon.points.slice(0, -1); // Remove duplicate last point
    }

    // Return the largest valid polygon
    const bestPolygon = validPolygons.sort((a, b) => {
      const aValidation = results.validation_report.find(v => v.cluster_id === a.cluster_id);
      const bValidation = results.validation_report.find(v => v.cluster_id === b.cluster_id);
      return bValidation.area - aValidation.area;
    })[0];

    return bestPolygon.points.slice(0, -1); // Remove duplicate last point
  }

  async function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    let rows;
    if (mode === 'utm2') {
      rows = parseTextMode2(text);
    } else if (mode === 'utm3') {
      rows = parseTextMode3(text);
    } else if (mode === 'utm4') {
      rows = parseTextMode4(text);
    } else if (mode === 'utm5') {
      rows = parseTextMode5(text);
    } else if (mode === 'utm6') {
      rows = parseTextMode6(text);
    } else {
      rows = parseText(text);
    }
    setNotice(`تعداد نقاط خوانده‌شده از فایل: ${rows.length}`);
  }

  function parseDxfRowsLight(text) {
    try {
      const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
      const ents = [];
      let i = 0;
      const readPair = (idx) => ({ code: lines[idx]?.trim(), value: lines[idx + 1] });
      while (i + 1 < lines.length) {
        const { code, value } = readPair(i);
        if (code === "0") {
          const type = (value || "").trim();
          if (type === "LWPOLYLINE") {
            i += 2;
            let closed = false;
            let pendingX = undefined;
            const pts = [];
            while (i + 1 < lines.length) {
              const p = readPair(i);
              if (p.code === "0") break;
              if (p.code === "70") {
                const flags = Number((p.value || "").trim());
                if (Number.isFinite(flags)) closed = (flags & 1) === 1;
              } else if (p.code === "10") {
                pendingX = Number((p.value || "").trim());
              } else if (p.code === "20") {
                const y = Number((p.value || "").trim());
                if (Number.isFinite(pendingX) && Number.isFinite(y)) {
                  pts.push({ easting: pendingX, northing: y });
                }
                pendingX = undefined;
              }
              i += 2;
            }
            if (pts.length >= 2) ents.push({ pts, closed });
            continue;
          }
          if (type === "POLYLINE") {
            i += 2;
            let closed = false;
            const pts = [];
            while (i + 1 < lines.length) {
              const p = readPair(i);
              if (p.code === "0") {
                const t = (p.value || "").trim();
                if (t === "VERTEX") {
                  i += 2;
                  let vx = undefined;
                  let vy = undefined;
                  while (i + 1 < lines.length) {
                    const pv = readPair(i);
                    if (pv.code === "0") break;
                    if (pv.code === "10") vx = Number((pv.value || "").trim());
                    if (pv.code === "20") vy = Number((pv.value || "").trim());
                    i += 2;
                  }
                  if (Number.isFinite(vx) && Number.isFinite(vy)) pts.push({ easting: vx, northing: vy });
                  continue;
                }
                if (t === "SEQEND") {
                  i += 2;
                  break;
                }
                // Unexpected type; break polyline
                break;
              }
              if (p.code === "70") {
                const flags = Number((p.value || "").trim());
                if (Number.isFinite(flags)) closed = (flags & 1) === 1;
              }
              i += 2;
            }
            if (pts.length >= 2) ents.push({ pts, closed });
            continue;
          }
        }
        i += 2;
      }
      if (!ents.length) return [];
      // Prefer closed with max points; fallback to largest entity
      const closed = ents.filter((e) => e.closed);
      const chosen = (closed.length ? closed : ents).sort((a, b) => (b.pts.length - a.pts.length))[0];
      return chosen.pts.map((p, idx) => ({ name: `P${idx + 1}`, easting: Number(p.easting), northing: Number(p.northing) }))
        .filter((p) => Number.isFinite(p.easting) && Number.isFinite(p.northing));
    } catch {
      return [];
    }
  }

  async function parseDxfRows(text) {
    try {
      // Try lightweight parser first (works in browser without deps)
      const light = parseDxfRowsLight(text);
      if (light && light.length >= 2) return light;
      
      // Fallback to dxf-parser if available (optional dependency)
      try {
        const mod = await import("dxf-parser");
        const DxfParser = mod.default || mod;
        const parser = new DxfParser();
        const d = parser.parseSync(text);
        const entities = Array.isArray(d?.entities) ? d.entities : [];
        const lwps = entities.filter((e) => e.type === "LWPOLYLINE");
        const polysClosed = lwps.filter((e) => e.closed || e.shape);
        const lw = (polysClosed.length ? polysClosed : lwps).sort((a, b) => (b.vertices?.length || 0) - (a.vertices?.length || 0))[0];
        let verts = [];
        if (lw && Array.isArray(lw.vertices)) {
          verts = lw.vertices
            .map((v, idx) => ({ name: `P${idx + 1}`, easting: Number(v.x), northing: Number(v.y) }))
            .filter((p) => Number.isFinite(p.easting) && Number.isFinite(p.northing));
        } else {
          const polys = entities.filter((e) => e.type === "POLYLINE");
          const poly = polys.sort((a, b) => (b.vertices?.length || 0) - (a.vertices?.length || 0))[0];
          if (poly && Array.isArray(poly.vertices)) {
            verts = poly.vertices
              .map((v, idx) => {
                const x = Number(v.location?.x ?? v.x);
                const y = Number(v.location?.y ?? v.y);
                return { name: `P${idx + 1}`, easting: x, northing: y };
              })
              .filter((p) => Number.isFinite(p.easting) && Number.isFinite(p.northing));
          }
        }
        return verts;
      } catch (importError) {
        // dxf-parser not available, use lightweight parser result
        return light || [];
      }
    } catch {
      return [];
    }
  }

  async function onDxfFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const verts = await parseDxfRows(text);
    setRawRows(verts);
    // Detect CRS from value ranges
    if (verts.length >= 2) {
      const xs = verts.map((v) => Math.abs(Number(v.easting)));
      const ys = verts.map((v) => Math.abs(Number(v.northing)));
      const inLonLat = xs.every((x) => x <= 180) && ys.every((y) => y <= 90);
      setRawType(inLonLat ? "wgs84" : "utm");
    } else {
      setRawType(null);
    }
    if (verts.length >= 2) setNotice(`DXF خوانده شد: ${verts.length} نقطه`);
    else setNotice("نتوانستم پلی‌لاین معتبری در DXF پیدا کنم.");
  }

  async function onDwgFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Fallback: some files with .dwg are actually DXF text; try local parse first
    try {
      const maybeText = await file.text();
      const asDxf = await parseDxfRows(maybeText);
      if (asDxf && asDxf.length >= 2) {
        setRawRows(asDxf);
        const xs = asDxf.map((v) => Math.abs(Number(v.easting)));
        const ys = asDxf.map((v) => Math.abs(Number(v.northing)));
        const inLonLat = xs.every((x) => x <= 180) && ys.every((y) => y <= 90);
        setRawType(inLonLat ? "wgs84" : "utm");
        setNotice(`DWG (DXF متنی) خوانده شد: ${asDxf.length} نقطه`);
        return;
      }
    } catch {}

    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/dwg-to-dxf", { method: "POST", body: fd });
      if (!res.ok) {
        if (res.status === 501) {
          setNotice("تبدیل DWG هنوز پیکربندی نشده است. لطفاً فایل را به DXF تبدیل کرده و بارگذاری کنید.");
          setRawRows([]);
          return;
        }
        throw new Error("convert failed");
      }
      const text = await res.text();
      const verts = await parseDxfRows(text);
      setRawRows(verts);
      if (verts.length >= 2) {
        const xs = verts.map((v) => Math.abs(Number(v.easting)));
        const ys = verts.map((v) => Math.abs(Number(v.northing)));
        const inLonLat = xs.every((x) => x <= 180) && ys.every((y) => y <= 90);
        setRawType(inLonLat ? "wgs84" : "utm");
      } else {
        setRawType(null);
      }
      if (verts.length >= 2) setNotice(`DWG تبدیل شد و ${verts.length} نقطه استخراج شد`);
      else setNotice("پس از تبدیل DWG، پلی‌لاین معتبری یافت نشد.");
    } catch {
      setRawRows([]);
      setNotice("خواندن/تبدیل DWG با خطا مواجه شد.");
    }
  }


  function handleShowOnMap() {
    if (mode === "utm" || mode === "utm2" || mode === "utm3" || mode === "utm4" || mode === "utm5" || mode === "utm6") {
      if (rawRows.length < 2) return;
      const wgs = convertManyUtmToLatLon(rawRows, { zone: Number(zone), hemisphere });
      onParsed?.({ points: wgs, projectInfo: { ...projectInfo, zone, hemisphere } });
      setNotice(`روی نقشه نمایش داده شد (${wgs.length} نقطه).`);
    } else if (mode === "polygon") {
      const pts = parsePolygonText(polygonText);
      if (!pts || pts.length < 2) return;
      const withUtm = convertManyLatLonToUtm(pts, { zone: Number(zone), hemisphere });
      onParsed?.({ points: withUtm, projectInfo: { ...projectInfo, zone, hemisphere } });
      setNotice(`پلی‌گان نمایش داده شد (${withUtm.length} نقطه).`);
    } else if (mode === "dxf") {
      if (rawRows.length < 2) return;
      if (rawType === "wgs84") {
        const latlon = rawRows.map((p) => ({ name: p.name, lat: Number(p.northing), lon: Number(p.easting) }));
        const enriched = convertManyLatLonToUtm(latlon, { zone: Number(zone), hemisphere });
        onParsed?.({ points: enriched, projectInfo: { ...projectInfo, zone, hemisphere } });
        setNotice(`DXF (WGS84) روی نقشه نمایش داده شد (${enriched.length} نقطه).`);
      } else {
        const wgs = convertManyUtmToLatLon(rawRows, { zone: Number(zone), hemisphere });
        onParsed?.({ points: wgs, projectInfo: { ...projectInfo, zone, hemisphere } });
        setNotice(`DXF (UTM) روی نقشه نمایش داده شد (${wgs.length} نقطه).`);
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4 flex-wrap">
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="utm" checked={mode === "utm"} onChange={() => setMode("utm")} />
          <span>ورودی TXT / CSV (مود 1)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="utm2" checked={mode === "utm2"} onChange={() => setMode("utm2")} />
          <span>ورودی TXT / CSV (مود 2)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="utm3" checked={mode === "utm3"} onChange={() => setMode("utm3")} />
          <span>ورودی TXT / CSV (مود 3)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="utm4" checked={mode === "utm4"} onChange={() => setMode("utm4")} />
          <span>ورودی TXT / CSV (مود 4 - هوشمند)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="utm5" checked={mode === "utm5"} onChange={() => setMode("utm5")} />
          <span>ورودی TXT / CSV (مود 5 - پیشرفته)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="utm6" checked={mode === "utm6"} onChange={() => setMode("utm6")} />
          <span>ورودی TXT / CSV (مود 6 - حرفه‌ای)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="dxf" checked={mode === "dxf"} onChange={() => setMode("dxf")} />
          <span>فایل DXF</span>
        </label>
      </div>

      {(mode === "utm" || mode === "utm2" || mode === "utm3" || mode === "utm4" || mode === "utm5" || mode === "utm6") ? (
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span>{mode === "utm3" ? "فایل خطوط مهندسی (CSV)" : mode === "utm4" ? "فایل خطوط مهندسی - هوشمند (CSV)" : mode === "utm5" ? "فایل خطوط مهندسی - پیشرفته (CSV)" : mode === "utm6" ? "فایل خطوط مهندسی - حرفه‌ای (CSV)" : "فایل نقاط UTM (CSV/TXT)"}</span>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={onFileChange} className="border p-2 rounded" />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span>زون UTM</span>
            <input type="number" value={zone} onChange={(e) => setZone(e.target.value)} className="border p-2 rounded" />
          </label>
          <label className="flex flex-col gap-1">
            <span>نیمکره</span>
            <select value={hemisphere} onChange={(e) => setHemisphere(e.target.value)} className="border p-2 rounded">
              <option value="north">شمالی</option>
              <option value="south">جنوبی</option>
            </select>
          </label>
        </div>
      </div>
      ) : mode === "polygon" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span>زون UTM برای برون‌داد متریک</span>
              <input type="number" value={zone} onChange={(e) => setZone(e.target.value)} className="border p-2 rounded" />
            </label>
            <label className="flex flex-col gap-1">
              <span>نیمکره</span>
              <select value={hemisphere} onChange={(e) => setHemisphere(e.target.value)} className="border p-2 rounded">
                <option value="north">شمالی</option>
                <option value="south">جنوبی</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span>متن پلی‌گان</span>
            <textarea
              value={polygonText}
              onChange={(e) => setPolygonText(e.target.value)}
              className="border p-2 rounded min-h-[120px]"
              placeholder={`نمونه‌ها:\n- WKT: POLYGON((51.3 35.7, 51.31 35.71, 51.29 35.72, 51.3 35.7))\n- GeoJSON: {"type":"Polygon","coordinates":[[[51.3,35.7],[51.31,35.71],[51.29,35.72],[51.3,35.7]]]}\n- lat,lon سطر به سطر: 35.7,51.3`}
            />
          </label>
        </div>
      ) : mode === "dxf" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span>فایل DXF</span>
              <input ref={dxfFileRef} type="file" accept=".dxf" onChange={onDxfFileChange} className="border p-2 rounded" />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span>زون UTM</span>
                <input type="number" value={zone} onChange={(e) => setZone(e.target.value)} className="border p-2 rounded" />
              </label>
              <label className="flex flex-col gap-1">
                <span>نیمکره</span>
                <select value={hemisphere} onChange={(e) => setHemisphere(e.target.value)} className="border p-2 rounded">
                  <option value="north">شمالی</option>
                  <option value="south">جنوبی</option>
                </select>
              </label>
            </div>
          </div>
          <p className="text-sm text-gray-600">از پلی‌لاین‌های بسته (LWPOLYLINE/POLYLINE) مختصات استخراج می‌شود.</p>
        </div>
      ) : null}

      {/* DWG mode removed per request */}

      <div className="grid sm:grid-cols-5 gap-4">
        <label className="flex flex-col gap-1">
          <span>محل پروژه</span>
          <input value={projectInfo.location} onChange={(e) => setProjectInfo((p) => ({ ...p, location: e.target.value }))} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col gap-1">
          <span>نام کارفرما</span>
          <input value={projectInfo.employer} onChange={(e) => setProjectInfo((p) => ({ ...p, employer: e.target.value }))} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col gap-1">
          <span>نام مجری</span>
          <input value={projectInfo.contractor} onChange={(e) => setProjectInfo((p) => ({ ...p, contractor: e.target.value }))} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col gap-1">
          <span>تاریخ</span>
          <input type="date" value={projectInfo.date} onChange={(e) => setProjectInfo((p) => ({ ...p, date: e.target.value }))} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col gap-1">
          <span>مقیاس نقشه</span>
          <input value={projectInfo.scale} onChange={(e) => setProjectInfo((p) => ({ ...p, scale: e.target.value }))} className="border p-2 rounded" />
        </label>
      </div>

      <div className="flex gap-2 flex-nowrap">
        <button
          onClick={handleShowOnMap}
          disabled={(((mode === "utm") || (mode === "utm2") || (mode === "utm3") || (mode === "utm4") || (mode === "utm5") || (mode === "utm6")) && rawRows.length < 2) || (mode === "dxf" && rawRows.length < 2)}
          className="bg-white text-gray-900 border border-gray-300 rounded px-4 py-2 disabled:opacity-50 hover:bg-gray-50"
        >
          نمایش روی نقشه
        </button>
      </div>
      {notice && (
        <div className="text-sm text-gray-700">{notice}</div>
      )}
    </div>
  );
}


