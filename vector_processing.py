import math

# Global runtime cache to keep active mesh tensors in memory
MAP_VERTICES = []
MAP_FACES = []

def process_image_to_heightmap(image_bytes, target_resolution=40):
    """Parses raw image files, transforms them to grayscale arrays, and builds a 3D tensor grid"""
    global MAP_VERTICES, MAP_FACES
    
    # 1. Load image and convert it into a normalized grayscale luminosity map
    img = Image.open(io.BytesIO(image_bytes)).convert('L')
    
    # Downscale the structural sampling frequency grid to prevent canvas rendering lags
    img = img.resize((target_resolution, target_resolution), Image.Resampling.LANCZOS)
    pixels = img.load()
    
    new_vertices = []
    new_faces = []
    
    # 2. Build 3D coordinate space displacement landscape
    for i in range(target_resolution):
        y_percent = i / (target_resolution - 1)
        y_pos = (y_percent * 2.0) - 1.0  # Normalized spacing bounds (-1.0 to 1.0)
        
        for j in range(target_resolution):
            x_percent = j / (target_resolution - 1)
            x_pos = (x_percent * 2.0) - 1.0
            
            # Read brightness intensity scale (0-255 mapped down to 0.0-1.0)
            brightness = pixels[j, i] / 255.0
            
            # Map structural luminosity straight to Z height axis depth displacement
            z_pos = brightness * 0.6  
            
            new_vertices.append([x_pos, y_pos, z_pos])
            
    # 3. Create matrix mesh connecting lines indices
    for i in range(target_resolution - 1):
        for j in range(target_resolution - 1):
            p0 = i * target_resolution + j
            p1 = i * target_resolution + (j + 1)
            p2 = (i + 1) * target_resolution + (j + 1)
            p3 = (i + 1) * target_resolution + j
            new_faces.append([p0, p1, p2, p3])
            
    MAP_VERTICES = new_vertices
    MAP_FACES = new_faces

def get_lighted_3d_mesh(angle_x, angle_y, light_x, light_y, light_z):
    # Fallback to a synthetic default pattern if no local files have been uploaded yet
    if not MAP_VERTICES:
        generate_fallback_mesh()

    rad_x = math.radians(angle_x)
    rad_y = math.radians(angle_y)

    cx, sx = math.cos(rad_x), math.sin(rad_x)
    cy, sy = math.cos(rad_y), math.sin(rad_y)

    # Matrix Multiplication: Apply dynamic rotations to geometry matrix positions
    rotated_vertices = []
    for x, y, z in MAP_VERTICES:
        # Rotation around Y axis
        x1 = x * cy + z * sy
        y1 = y
        z1 = -x * sy + z * cy
        
        # Rotation around X axis
        x2 = x1
        y2 = y1 * cx - z1 * sx
        z2 = y1 * sx + z1 * cx
        
        rotated_vertices.append([x2, y2, z2])

    # Standardize lighting position direction vector properties
    light_len = math.sqrt(light_x**2 + light_y**2 + light_z**2) or 1
    lx, ly, lz = light_x / light_len, light_y / light_len, light_z / light_len

    rendered_faces = []

    for face in MAP_FACES:
        p0 = rotated_vertices[face[0]]
        p1 = rotated_vertices[face[1]]
        p2 = rotated_vertices[face[2]]
        p3 = rotated_vertices[face[3]]

        # Normal vector tracking via matrix cross product
        v1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
        v2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]
        
        normal = [
            v1[1]*v2[2] - v1[2]*v2[1],
            v1[2]*v2[0] - v1[0]*v2[2],
            v1[0]*v2[1] - v1[1]*v2[0]
        ]
        
        normal_len = math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2) or 1
        nx, ny, nz = normal[0]/normal_len, normal[1]/normal_len, normal[2]/normal_len

        # Matrix Dot Product determines surface lighting brightness intensities
        dot_product = nx*lx + ny*ly + nz*lz
        
        ambient_light = 0.15
        diffuse_intensity = max(0.0, dot_product)
        total_illumination = ambient_light + (1.0 - ambient_light) * diffuse_intensity

        # Volumetric Bronze Palette shading treatments
        # r = int(220 * total_illumination)
        # g = int(140 * total_illumination)
        # b = int(60 * total_illumination)

        # Base Color: Hex #0ea5e9 / RGB (14, 165, 233)
        # r = int(14 * total_illumination)
        # g = int(165 * total_illumination)
        # b = int(233 * total_illumination)

        # Base Color: Hex #cbd5e1 / RGB (203, 213, 225)
        # r = int(203 * total_illumination)
        # g = int(213 * total_illumination)
        # b = int(225 * total_illumination)

        # Base Color: Hex #10b981 / RGB (16, 185, 129)
        # r = int(16 * total_illumination)
        # g = int(185 * total_illumination)
        # b = int(129 * total_illumination)

        # Base Color: Hex #f43f5e / RGB (244, 63, 94)
        r = int(244 * total_illumination)
        g = int(63 * total_illumination)
        b = int(94 * total_illumination)




        avg_z = (p0[2] + p1[2] + p2[2] + p3[2]) / 4.0

        face_points_2d = []
        for vert_idx in face:
            pt = rotated_vertices[vert_idx]
            scale = 130
            screen_x = pt[0] * scale + 200
            screen_y = -pt[1] * scale + 200 # Reverse canvas layout Y space
            face_points_2d.append({"x": screen_x, "y": screen_y})

        rendered_faces.append({
            "points": face_points_2d,
            "color": f"rgb({r}, {g}, {b})",
            "avg_z": avg_z
        })

    # Painter's Algorithm sorting structure prevents background face leaks
    rendered_faces.sort(key=lambda f: f["avg_z"])

    return {
        "faces": rendered_faces,
        "raw_tensor_state": {
            "angles": {"x": angle_x, "y": angle_y},
            "light": {"x": light_x, "y": light_y, "z": light_z}
        }
    }

def generate_fallback_mesh():
    """Generates a default geometric wave structure if no custom file has been uploaded"""
    res = 30
    fallback_bytes = io.BytesIO()
    img = Image.new('L', (res, res))
    pixels = img.load()
    for i in range(res):
        for j in range(res):
            dist = math.sqrt(((i/res)-0.5)**2 + ((j/res)-0.5)**2)
            pixels[j, i] = int((math.sin(dist * 12) + 1.0) * 127)
    img.save(fallback_bytes, format='PNG')
    process_image_to_heightmap(fallback_bytes.getvalue(), target_resolution=35)

# ==========================================
# 1. GENERATE A VOLUMETRIC 3D MESH FROM AN IMAGE GRID
# ==========================================
def generate_image_heightmap_tensor(resolution=32):
    vertices = []
    faces = []
    
    # Create coordinate grid maps
    for i in range(resolution):
        y_percent = i / (resolution - 1)
        y_pos = (y_percent * 2.0) - 1.0  # Scale between -1.0 and 1.0
        
        for j in range(resolution):
            x_percent = j / (resolution - 1)
            x_pos = (x_percent * 2.0) - 1.0  # Scale between -1.0 and 1.0
            
            # Synthetic 2D Image Shape: A complex geometric wave pattern (Depth displacement)
            # Simulated grayscale pixel intensity value (0.0 to 1.0)
            dist = math.sqrt(x_pos**2 + y_pos**2)
            pixel_intensity = math.exp(-(dist**2) / 0.3) * math.cos(dist * math.pi * 1.5)
            
            # Map Intensity directly to Z depth displacement tensor
            z_pos = pixel_intensity * 0.5  
            
            vertices.append([x_pos, y_pos, z_pos])
            
    # Connect array nodes sequentially into structural face rendering surfaces
    for i in range(resolution - 1):
        for j in range(resolution - 1):
            p0 = i * resolution + j
            p1 = i * resolution + (j + 1)
            p2 = (i + 1) * resolution + (j + 1)
            p3 = (i + 1) * resolution + j
            faces.append([p0, p1, p2, p3])
            
    return vertices, faces

# Cache our structural multi-dimensional tensor arrays in memory
MAP_VERTICES, MAP_FACES = generate_image_heightmap_tensor()

# ==========================================
# 2. MATRIX OPERATION & SHADOW PIPELINE
# ==========================================
def get_lighted_3d_mesh(angle_x, angle_y, light_x, light_y, light_z):
    rad_x = math.radians(angle_x)
    rad_y = math.radians(angle_y)

    cx, sx = math.cos(rad_x), math.sin(rad_x)
    cy, sy = math.cos(rad_y), math.sin(rad_y)

    # Matrix Multiplication: Apply Rotations to spatial coordinates
    rotated_vertices = []
    for x, y, z in MAP_VERTICES:
        # Rotate along Y-axis matrix profile
        x1 = x * cy + z * sy
        y1 = y
        z1 = -x * sy + z * cy
        
        # Rotate along X-axis matrix profile
        x2 = x1
        y2 = y1 * cx - z1 * sx
        z2 = y1 * sx + z1 * cx
        
        rotated_vertices.append([x2, y2, z2])

    # Standardize our light source input direction vector (Normalization)
    light_len = math.sqrt(light_x**2 + light_y**2 + light_z**2) or 1
    lx, ly, lz = light_x / light_len, light_y / light_len, light_z / light_len

    rendered_faces = []

    for face in MAP_FACES:
        p0 = rotated_vertices[face[0]]
        p1 = rotated_vertices[face[1]]
        p2 = rotated_vertices[face[2]]
        p3 = rotated_vertices[face[3]]

        # Normal vector extraction via vector subtraction cross product
        v1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
        v2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]
        
        normal = [
            v1[1]*v2[2] - v1[2]*v2[1],
            v1[2]*v2[0] - v1[0]*v2[2],
            v1[0]*v2[1] - v1[1]*v2[0]
        ]
        
        normal_len = math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2) or 1
        nx, ny, nz = normal[0]/normal_len, normal[1]/normal_len, normal[2]/normal_len

        # --- LAMBERTIAN SURFACE LIGHT SHADOW MATH ---
        # Matrix Dot Product determines alignment relative to lighting vector direction
        dot_product = nx*lx + ny*ly + nz*lz
        
        # Enforce shadows boundary limits (clamp values between ambient floor and 1.0)
        ambient_light = 0.15
        diffuse_intensity = max(0.0, dot_product)
        total_illumination = ambient_light + (1.0 - ambient_light) * diffuse_intensity

        # Base Image Palette: Vibrant Golden Landscape (R=240, G=160, B=40)
        r = int(240 * total_illumination)
        g = int(160 * total_illumination)
        b = int(40 * total_illumination)

        # Painters algorithm sort mechanism baseline tracking
        avg_z = (p0[2] + p1[2] + p2[2] + p3[2]) / 4.0

        # Project 3D coordinate space maps into 2D view frames
        face_points_2d = []
        for vert_idx in face:
            pt = rotated_vertices[vert_idx]
            scale = 120
            screen_x = pt[0] * scale + 200
            screen_y = -pt[1] * scale + 200  # Flip structural Y to match canvas layouts
            face_points_2d.append({"x": screen_x, "y": screen_y})

        rendered_faces.append({
            "points": face_points_2d,
            "color": f"rgb({r}, {g}, {b})",
            "avg_z": avg_z
        })

    # Execute depth sort ordering framework to secure clean geometric visual occlusion
    rendered_faces.sort(key=lambda f: f["avg_z"])

    return {
        "faces": rendered_faces,
        "raw_tensor_state": {
            "angles": {"x": angle_x, "y": angle_y},
            "light": {"x": light_x, "y": light_y, "z": light_z}
        }
    }
