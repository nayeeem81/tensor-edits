const canvas = document.getElementById('displayCanvas');
const ctx = canvas.getContext('2d');

let savedTensorsCollection = [];
let animationIntervalId = null;
let playbackIntervalId = null;
let currentTensorPayload = null;

// Core Render Synchronizer Engine (Concatenation string formatting avoiding template token bugs)
async function fetchAndRenderFrame(degX, degY) {
    document.getElementById('rotateX').value = degX;
    document.getElementById('rotateY').value = degY;
    document.getElementById('valX').innerText = degX;
    document.getElementById('valY').innerText = degY;

    try {
        const response = await fetch('/api/facerender?x=' + degX + '&y=' + degY);
        const data = await response.json();

        currentTensorPayload = data.raw_tensor_state;
        drawCanvasMesh(data.faces);
    } catch (err) {
        console.error("Pipeline failure requesting face geometry array updates:", err);
    }
}

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

        // Fine-line opacity treatment prevents wireframe overcrowding on high density vectors
        ctx.strokeStyle = 'rgba(30, 41, 59, 0.15)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    });
}

async function playUploadedSequence() {
    stopAllIntervals();
    if (savedTensorsCollection.length === 0) return;

    let currentIndex = 0;
    document.getElementById('animStatus').innerText = "Playing Uploaded File";
    document.getElementById('animStatus').style.color = "#9b59b6";
    document.getElementById('stopBtn').disabled = false;

    playbackIntervalId = setInterval(async () => {
        if (currentIndex >= savedTensorsCollection.length) currentIndex = 0;
        const snapshotFrame = savedTensorsCollection[currentIndex];
        await fetchAndRenderFrame(snapshotFrame.angles.x, snapshotFrame.angles.y);
        currentIndex++;
    }, 500); // 500ms playback updates
}

function stopAllIntervals() {
    if (animationIntervalId) { clearInterval(animationIntervalId); animationIntervalId = null; }
    if (playbackIntervalId) { clearInterval(playbackIntervalId); playbackIntervalId = null; }
    document.getElementById('animStatus').innerText = "Idle";
    document.getElementById('animStatus').style.color = "#e67e22";
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
}

function startAutoRotationLoop() {
    stopAllIntervals();
    let currentX = parseInt(document.getElementById('rotateX').value);
    let currentY = parseInt(document.getElementById('rotateY').value);

    document.getElementById('animStatus').innerText = "Running Combinations";
    document.getElementById('animStatus').style.color = "#2ecc71";
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;

    animationIntervalId = setInterval(async () => {
        currentX = (currentX + 12) % 360;
        currentY = (currentY + 8) % 360;
        await fetchAndRenderFrame(currentX, currentY);
        captureCurrentTensorState();
    }, 400);
}

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
        li.innerText = `[Face-${index}] X:${item.angles.x}° Y:${item.angles.y}°`;
        li.addEventListener('click', () => {
            stopAllIntervals();
            fetchAndRenderFrame(item.angles.x, item.angles.y);
        });
        container.appendChild(li);
    });

    if (savedTensorsCollection.length > 0) {
        document.getElementById('playFileBtn').disabled = false;
    }
}

function exportCollectionToJSONFile() {
    if (savedTensorsCollection.length === 0) return;
    const dataString = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(savedTensorsCollection, null, 2));

    const dlAnchor = document.createElement('a'); dlAnchor.setAttribute("href", dataString);

    dlAnchor.setAttribute("download", "face_tensor_rotation_history.json"); document.body.appendChild(dlAnchor); dlAnchor.click(); dlAnchor.remove();
}

function importCollectionFromJSONFile(event) {
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const parsedData = JSON.parse(e.target.result);

            if (Array.isArray(parsedData)) {
                savedTensorsCollection = parsedData; updateHistoryLayoutView();
            }
        } catch (err) {
            alert("Failure parsing face log JSON file configuration layout structural layers.");
        }
    };

    reader.readAsText(event.target.files);
}

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

// Initial setup render execution cyclefetchAndRenderFrame(25, 45);