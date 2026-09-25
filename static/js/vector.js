const canvas = document.getElementById('displayCanvas');
        const ctx = canvas.getContext('2d');

        let savedTensorsCollection = [];
        let animationIntervalId = null;
        let playbackIntervalId = null;
        let currentTensorPayload = null;

        async function fetchAndRenderPipelineFrame() {
            const dx = document.getElementById('rotateX').value;
            const dy = document.getElementById('rotateY').value;
            const lx = (parseFloat(document.getElementById('lightX').value) / 10).toFixed(1);
            const ly = (parseFloat(document.getElementById('lightY').value) / 10).toFixed(1);
            const lz = (parseFloat(document.getElementById('lightZ').value) / 10).toFixed(1);

            document.getElementById('valX').innerText = dx;
            document.getElementById('valY').innerText = dy;
            document.getElementById('valLX').innerText = lx;
            document.getElementById('valLY').innerText = ly;
            document.getElementById('valLZ').innerText = lz;

            const requestUrl = '/api/rendervector?x=' + dx + '&y=' + dy + '&lx=' + lx + '&ly=' + ly + '&lz=' + lz;

            try {
                const response = await fetch(requestUrl);
                const data = await response.json();
                currentTensorPayload = data.raw_tensor_state;
                drawMeshVectors(data.faces);
            } catch (err) {
                console.error("Vector rendering data exchange pipeline structural breakdown:", err);
            }
        }

        // POST Image Upload pipeline implementation
        async function handleLocalImageUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('image', file);

            try {
                document.getElementById('animStatus').innerText = "Uploading Tensor File...";
                const response = await fetch('/api/upload_image', {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();

                if (result.success) {
                    document.getElementById('animStatus').innerText = "Mesh Loaded!";
                    fetchAndRenderPipelineFrame(); // Instantly update view
                } else {
                    alert("Upload error: " + result.error);
                }
            } catch (err) {
                console.error("Error piping local file to Python endpoint engine:", err);
            } finally {
                setTimeout(() => {
                    if (!animationIntervalId && !playbackIntervalId) {
                        document.getElementById('animStatus').innerText = "Idle";
                    }
                }, 1500);
            }
        }

        function drawMeshVectors(faces) {
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
                ctx.strokeStyle = 'rgba(15, 23, 42, 0.08)';
                ctx.lineWidth = 0.4;
                ctx.stroke();
            });
        }

        function stopAllIntervals() {
            if (animationIntervalId) { clearInterval(animationIntervalId); animationIntervalId = null; }
            if (playbackIntervalId) { clearInterval(playbackIntervalId); playbackIntervalId = null; }

            document.getElementById('animStatus').innerText = "Idle";

            document.getElementById('animStatus').style.color = "#f59e0b"; document.getElementById('startBtn').disabled = false; document.getElementById('stopBtn').disabled = true;
        }

        function startAutoRotationLoop() {
            stopAllIntervals();

            let currentX = parseInt(document.getElementById('rotateX').value);

            let currentY = parseInt(document.getElementById('rotateY').value);

            document.getElementById('animStatus').innerText = "Processing Sequence Loop";

            document.getElementById('animStatus').style.color = "#10b981";

            document.getElementById('startBtn').disabled = true;

            document.getElementById('stopBtn').disabled = false;

            animationIntervalId = setInterval(async () => {
                currentX = (currentX + 10) % 360; currentY = (currentY + 6) % 360; document.getElementById('rotateX').value = currentX;

                document.getElementById('rotateY').value = currentY;

                await fetchAndRenderPipelineFrame();

                captureCurrentTensorState();
            }, 300);
        }

        function playUploadedSequence() {

            stopAllIntervals();

            if (savedTensorsCollection.length === 0) return;

            let currentIndex = 0;
            document.getElementById('animStatus').innerText = "Playing JSON Trail";

            document.getElementById('animStatus').style.color = "#8b5cf6";

            document.getElementById('stopBtn').disabled = false; playbackIntervalId = setInterval(async () => {

                if (currentIndex >= savedTensorsCollection.length) currentIndex = 0;

                const frame = savedTensorsCollection[currentIndex]; document.getElementById('rotateX').value = frame.angles.x;

                document.getElementById('rotateY').value = frame.angles.y;

                document.getElementById('lightX').value = frame.light.x * 10;

                document.getElementById('lightY').value = frame.light.y * 10; document.getElementById('lightZ').value = frame.light.z * 10;

                await fetchAndRenderPipelineFrame();
                currentIndex++;
            }, 250);
        }

        function captureCurrentTensorState() { if (!currentTensorPayload) return; const structuralSnapshot = JSON.parse(JSON.stringify(currentTensorPayload)); structuralSnapshot.timestamp = new Date().toLocaleTimeString(); savedTensorsCollection.push(structuralSnapshot); updateHistoryLayoutView(); } function updateHistoryLayoutView() {
            document.getElementById('savedCount').innerText = savedTensorsCollection.length; const container = document.getElementById('historyList'); container.innerHTML = ""; savedTensorsCollection.forEach((item, index) => {
                const li = document.createElement('li'); li.innerText = `Frame ${index}: Mesh (X: ${item.angles.x}, Y: ${item.angles.y})`;

                li.addEventListener('click', () => {

                    stopAllIntervals();
                    document.getElementById('rotateX').value = item.angles.x;

                    document.getElementById('rotateY').value = item.angles.y; document.getElementById('lightX').value = item.light.x * 10;

                    document.getElementById('lightY').value = item.light.y * 10; document.getElementById('lightZ').value = item.light.z * 10;

                    fetchAndRenderPipelineFrame();
                }); container.appendChild(li);
            });

            if (savedTensorsCollection.length > 0) {
                document.getElementById('playFileBtn').disabled = false;
            }
        } function exportCollectionToJSONFile() { if (savedTensorsCollection.length === 0) return; const dataString = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(savedTensorsCollection, null, 2)); const dlAnchor = document.createElement('a'); dlAnchor.setAttribute("href", dataString); dlAnchor.setAttribute("download", "volumetric_image_history.json"); document.body.appendChild(dlAnchor); dlAnchor.click(); dlAnchor.remove(); } function importCollectionFromJSONFile(event) { const reader = new FileReader(); reader.onload = function (e) { try { const parsedData = JSON.parse(e.target.result); if (Array.isArray(parsedData)) { savedTensorsCollection = parsedData; updateHistoryLayoutView(); } } catch (err) { alert("Failure parsing target sequence log JSON arrays."); } }; reader.readAsText(event.target.files); }

        // Attach layout hooks to

        const inputs = ['rotateX', 'rotateY', 'lightX', 'lightY', 'lightZ'];
        inputs.forEach(id => {
            document.getElementById(id).addEventListener('input', () => {
                if (id.startsWith('rotate')) stopAllIntervals();
                fetchAndRenderPipelineFrame();
            });
        });
        document.getElementById('imageSourceInput').addEventListener('change', handleLocalImageUpload);
        document.getElementById('startBtn').addEventListener('click', startAutoRotationLoop);
        document.getElementById('stopBtn').addEventListener('click', stopAllIntervals);
        document.getElementById('saveBtn').addEventListener('click', captureCurrentTensorState);
        document.getElementById('downloadBtn').addEventListener('click', exportCollectionToJSONFile);
        document.getElementById('playFileBtn').addEventListener('click', playUploadedSequence);
        document.getElementById('uploadTriggerBtn').addEventListener('click', () => document.getElementById('jsonFileInput').click());
        document.getElementById('jsonFileInput').addEventListener('change', importCollectionFromJSONFile);

        // Run default baseline bootstrap initialization
        fetchAndRenderPipelineFrame();