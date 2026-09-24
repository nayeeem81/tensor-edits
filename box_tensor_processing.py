import math
from flask import Flask, jsonify, render_template, request

# Core 3D Model Tensors (List Representation)
VERTICES = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
]

FACES = [
    [0, 1, 2, 3],  # Bottom
    [4, 5, 6, 7],  # Top
    [0, 4, 7, 3],  # Front
    [1, 5, 6, 2],  # Back
    [0, 1, 5, 4],  # Left
    [3, 2, 6, 7],  # Right
]


def get_rotated_and_colored_boxmesh(angle_x, angle_y):
    rad_x = math.radians(angle_x)
    rad_y = math.radians(angle_y)

    cx, sx = math.cos(rad_x), math.sin(rad_x)
    cy, sy = math.cos(rad_y), math.sin(rad_y)

    # 1. Apply Rotation Transformations
    rotated_vertices = []
    for x, y, z in VERTICES:
        # Rotate around Y-axis
        x1 = x * cy + z * sy
        y1 = y
        z1 = -x * sy + z * cy

        # Rotate around X-axis
        x2 = x1
        y2 = y1 * cx - z1 * sx
        z2 = y1 * sx + z1 * cx

        rotated_vertices.append([x2, y2, z2])

    rendered_faces = []

    # 2. Compute Surface Directions & Map RGB Normals
    for face in FACES:
        p0 = rotated_vertices[face[0]]
        p1 = rotated_vertices[face[1]]
        p2 = rotated_vertices[face[2]]

        # Cross Product to determine surface normal vector
        v1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
        v2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]

        normal = [
            v1[1] * v2[2] - v1[2] * v2[1],
            v1[2] * v2[0] - v1[0] * v2[2],
            v1[0] * v2[1] - v1[1] * v2[0],
        ]

        # Calculate unit direction cleanly without tuple bugs
        length = math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2) or 1

        r = int(abs(normal[0] / length) * 255)
        g = int(abs(normal[1] / length) * 255)
        b = int(abs(normal[2] / length) * 255)

        # 3. Perspective Grid Projection Map
        face_points_2d = []
        for vert_idx in face:
            pt = rotated_vertices[vert_idx]
            scale = 100
            screen_x = pt[0] * scale + 200  # Canvas width center alignment
            screen_y = pt[1] * scale + 200  # Canvas height center alignment
            face_points_2d.append({"x": screen_x, "y": screen_y})

        rendered_faces.append(
            {"points": face_points_2d, "color": f"rgb({r}, {g}, {b})"}
        )

    return {
        "faces": rendered_faces,
        "raw_tensor_state": {
            "angles": {"x": angle_x, "y": angle_y},
            "rotated_vertices": rotated_vertices,
        },
    }
