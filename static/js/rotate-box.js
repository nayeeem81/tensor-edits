const canvas = document.getElementById('displayCanvas');
const ctx = canvas.getContext('2d');

// State Tracking Vaults
let savedTensorsCollection = [];
let animationIntervalId = null;
let playbackIntervalId = null; // New tracking pointer for file playing loop
let currentTensorPayload = null;

// 1. Core API Render Synchronization Engine (Python Backend Request)
async function fetchAndRenderFrame(degX, degY) {
    document.getElementById('rotateX').value = degX;
    document.getElementById('rotateY').value = degY;
    document.getElementById('valX').innerText = degX;
    document.getElementById('valY').innerText = degY;

    try {
        const response = await fetch(`/api/boxrender?x=${degX}&y=${degY}`);
        const data = await response.json();

        currentTensorPayload = data.raw_tensor_state;
        drawCanvasMesh(data.faces);
    } catch (err) {
        console.error("Pipeline breakdown fetching matrix framework:", err);
    }
}

// 2. Pure Canvas Vector Painting Strategy
function drawCanvasMesh(faces) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    faces.forEach(face => {
        ctx.beginPath();
        face.points.forEach((point, idx) => {
            if (idx === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.closePath();
        ctx.fillStyle = face.color;
        ctx.fill();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.stroke();
    });
}

// 3. New Client-Side Playback Processing Engine (Uses Python Endpoint Internally)
async function playUploadedSequence() {
    // Clear any running operational intervals first
    stopAllIntervals();

    if (savedTensorsCollection.length === 0) {
        alert("No loaded tensor framework found to playback.");
        return;
    }

    let currentIndex = 0;
    document.getElementById('animStatus').innerText = "Playing Uploaded File";
    document.getElementById('animStatus').style.color = "#9b59b6";
    document.getElementById('stopBtn').disabled = false;

    playbackIntervalId = setInterval(async () => {
        if (currentIndex >= savedTensorsCollection.length) {
            // Loop playback back to frame index 0 or choose to clear it out
            currentIndex = 0;
        }

        const snapshotFrame = savedTensorsCollection[currentIndex];

        // Pass saved angles back to the Python endpoint engine to dynamically acquire the face colors/mesh mapping
        await fetchAndRenderFrame(snapshotFrame.angles.x, snapshotFrame.angles.y);

        currentIndex++;
    }, 500); // Steps to a new saved state layout every 500ms
}

// Helper to reliably halt active looping logic loops
function stopAllIntervals() {
    if (animationIntervalId) {
        clearInterval(animationIntervalId);
        animationIntervalId = null;
    }
    if (playbackIntervalId) {
        clearInterval(playbackIntervalId);
        playbackIntervalId = null;
    }
    document.getElementById('animStatus').innerText = "Idle";
    document.getElementById('animStatus').style.color = "#e67e22";
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
}

// 4. Live Step Clock Interval Generator Loop
function startAutoRotationLoop() {
    stopAllIntervals();
    let currentX = parseInt(document.getElementById('rotateX').value);
    let currentY = parseInt(document.getElementById('rotateY').value);

    document.getElementById('animStatus').innerText = "Running Matrix Combinations";
    document.getElementById('animStatus').style.color = "#2ecc71";
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;

    animationIntervalId = setInterval(async () => {
        currentX = (currentX + 15) % 360;
        currentY = (currentY + 10) % 360;
        await fetchAndRenderFrame(currentX, currentY);
        captureCurrentTensorState();
    }, 600);
}

// 5. History Capture Vault Methods
function captureCurrentTensorState() {
    if (!currentTensorPayload) return;
    const structuralSnapshot = JSON.parse(JSON.stringify(currentTensorPayload));
    structuralSnapshot.timestamp = new Date().toLocaleTimeString();
    savedTensorsCollection.push(structuralSnapshot);
    updateHistoryLayoutView();
}

function updateHistoryLayoutView() {
    document.getElementById('savedCount').innerText = savedTensorsCollection.length;
    const container = document.getElementById('historyList');
    container.innerHTML = "";

    savedTensorsCollection.forEach((item, index) => {
        const li = document.createElement('li');
        li.innerText = `[T-${index}] X:${item.angles.x}° Y:${item.angles.y}° (${item.timestamp})`;
        li.addEventListener('click', () => {
            stopAllIntervals();
            fetchAndRenderFrame(item.angles.x, item.angles.y);
        });
        container.appendChild(li);
    });

    // Enable the playback operational trigger button if data registers exist
    if (savedTensorsCollection.length > 0) {
        document.getElementById('playFileBtn').disabled = false;
    }
}

// 6. JSON File Export Action Handler
function exportCollectionToJSONFile() {
    if (savedTensorsCollection.length === 0) return;
    const dataString = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(savedTensorsCollection, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataString);
    dlAnchor.setAttribute("download", "tensor_rotation_history.json");
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
}

// 7. JSON Upload Input Hook
function importCollectionFromJSONFile(event) {
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const parsedData = JSON.parse(e.target.result);
            if (Array.isArray(parsedData)) {
                savedTensorsCollection = parsedData;
                updateHistoryLayoutView();
            } else {
                alert("Malformed data format.");
            }
        } catch (err) {
            alert("Failure executing file analysis verification parser.");
        }
    };
    reader.readAsText(event.target.files);
}

// Bootstrap Listeners Connectors
document.getElementById('rotateX').addEventListener('input', (e) => {
    stopAllIntervals();
    fetchAndRenderFrame(e.target.value, document.getElementById('rotateY').value);
});
document.getElementById('rotateY').addEventListener('input', (e) => {
    stopAllIntervals();
    fetchAndRenderFrame(document.getElementById('rotateX').value, e.target.value);
});

document.getElementById('startBtn').addEventListener('click', startAutoRotationLoop);
document.getElementById('stopBtn').addEventListener('click', stopAllIntervals);
document.getElementById('saveBtn').addEventListener('click', captureCurrentTensorState);
document.getElementById('downloadBtn').addEventListener('click', exportCollectionToJSONFile);
document.getElementById('playFileBtn').addEventListener('click', playUploadedSequence);

document.getElementById('uploadTriggerBtn').addEventListener('click', () => document.getElementById('jsonFileInput').click());
document.getElementById('jsonFileInput').addEventListener('change', importCollectionFromJSONFile);

fetchAndRenderFrame(0, 0);

