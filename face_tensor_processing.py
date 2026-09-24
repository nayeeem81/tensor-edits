import math

def generate_woman_face_tensor():
    """Dynamically generates a 3D grid tensor morphed with feminine facial features"""
    vertices = []
    faces = []
    
    rows = 20  # Vertical resolution (Forehead to Chin)
    cols = 20  # Horizontal resolution (Ear to Ear)
    
    for i in range(rows):
        # Latitude map: maps top of head down to neck area
        lat = (math.pi / 3) - (i / (rows - 1)) * (2 * math.pi / 3)
        y = math.sin(lat)
        r_base = math.cos(lat)
        
        for j in range(cols):
            # Longitude map: wraps across the face profile
            lon = -(math.pi / 2.5) + (j / (cols - 1)) * (2 * math.pi / 2.5)
            
            # Baseline ellipsoid values
            x = math.sin(lon) * r_base * 0.85
            z = math.cos(lon) * r_base * 0.95
            
            # --- Algorithmic Facial Feature Deformations ---
            
            # 1. Nose Bridge & Tip (High center-focused extrusion)
            nose_h = math.exp(-((lat - 0.05) ** 2) / 0.03)
            nose_w = math.exp(-(lon ** 2) / 0.015)
            nose_bump = 0.38 * nose_h * nose_w
            
            # 2. Eye Sockets (Symmetrical indentations left and right)
            eye_lat = 0.22
            eye_lon_l, eye_lon_r = -0.22, 0.22
            socket_l = 0.12 * math.exp(-((lat - eye_lat)**2)/0.015 - ((lon - eye_lon_l)**2)/0.02)
            socket_r = 0.12 * math.exp(-((lat - eye_lat)**2)/0.015 - ((lon - eye_lon_r)**2)/0.02)
            
            # 3. Lips & Mouth structure (Slight vertical double ridge below nose)
            mouth_lat = -0.18
            mouth_h = math.exp(-((lat - mouth_lat)**2) / 0.015)
            mouth_w = math.exp(-(lon**2) / 0.05)
            mouth_bump = 0.09 * mouth_h * mouth_w
            
            # 4. Feminine Tapered Chin & Jawline Contouring
            chin_lat = -0.55
            chin_bump = 0.12 * math.exp(-((lat - chin_lat)**2)/0.02) * math.exp(-(lon**2)/0.02)
            
            # Apply all depth shifts to the Z axis
            z += nose_bump - socket_l - socket_r + mouth_bump + chin_bump
            
            # Slim down the lower jaw width to create a distinct feminine aesthetic profile
            if lat < 0:
                jaw_slimming = 1.0 + (lat * 0.38) * (abs(lon) / (math.pi / 2.5))
                x *= max(0.4, jaw_slimming)
            
            # Balance scaling indices to align visually within the browser display viewport bounds
            vertices.append([x * 1.4, y * 1.4, (z - 0.4) * 1.4])
            
    # Generate structural mesh indices connecting the nodes into matrix surfaces
    for i in range(rows - 1):
        for j in range(cols - 1):
            p0 = i * cols + j
            p1 = i * cols + (j + 1)
            p2 = (i + 1) * cols + (j + 1)
            p3 = (i + 1) * cols + j
            faces.append([p0, p1, p2, p3])
            
    return vertices, faces

# Build and store the Face model tensors inside runtime memory environment
FACE_VERTICES, FACE_FACES = generate_woman_face_tensor()

def get_rotated_and_colored_mesh(angle_x, angle_y):
    rad_x = math.radians(angle_x)
    rad_y = math.radians(angle_y)

    cx, sx = math.cos(rad_x), math.sin(rad_x)
    cy, sy = math.cos(rad_y), math.sin(rad_y)

    # 1. Coordinate Transform Engine Rotation Mapping
    rotated_vertices = []
    for x, y, z in FACE_VERTICES:
        # Rotate around Y axis
        x1 = x * cy + z * sy
        y1 = y
        z1 = -x * sy + z * cy
        
        # Rotate around X axis
        x2 = x1
        y2 = y1 * cx - z1 * sx
        z2 = y1 * sx + z1 * cx
        
        rotated_vertices.append([x2, y2, z2])

    rendered_faces = []

    # 2. Surface Rendering & Lighting Normal Maps Extraction Loop
    for face in FACE_FACES:
        p0 = rotated_vertices[face[0]]
        p1 = rotated_vertices[face[1]]
        p2 = rotated_vertices[face[2]]
        p3 = rotated_vertices[face[3]]

        # Vector Cross Product calculation defining surface orientations
        v1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
        v2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]
        
        normal = [
            v1[1]*v2[2] - v1[2]*v2[1],
            v1[2]*v2[0] - v1[0]*v2[2],
            v1[0]*v2[1] - v1[1]*v2[0]
        ]
        
        length = math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2) or 1
        
        # Shift coordinate vectors cleanly to bright RGB value scales
        r = int(abs(normal[0] / length) * 255)
        g = int(abs(normal[1] / length) * 255)
        b = int(abs(normal[2] / length) * 255)

        # Calculate average Z depth for 3D sorting optimization
        avg_z = (p0[2] + p1[2] + p2[2] + p3[2]) / 4.0

        face_points_2d = []
        for vert_idx in face:
            pt = rotated_vertices[vert_idx]
            scale = 130
            screen_x = pt[0] * scale + 200
            screen_y = -pt[1] * scale + 200  # Invert Y to correct canvas coordinate space orientation
            face_points_2d.append({"x": screen_x, "y": screen_y})

        rendered_faces.append({
            "points": face_points_2d,
            "color": f"rgb({r}, {g}, {b})",
            "avg_z": avg_z
        })

    # 3. Painter's Algorithm: Sort faces from back to front using Z-depth index
    rendered_faces.sort(key=lambda f: f["avg_z"])

    return {
        "faces": rendered_faces,
        "raw_tensor_state": {
            "angles": {"x": angle_x, "y": angle_y},
            "rotated_vertices": rotated_vertices
        }
    }
