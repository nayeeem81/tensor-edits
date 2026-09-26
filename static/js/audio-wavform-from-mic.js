const canvas = document.getElementById('waveformCanvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');

const maxSamples = 1000;
let dataBuffer = new Array(maxSamples).fill(0);

let audioContext;
let stream;
let processor;

const socket = io();

// 1. Receive continuous data back to render on canvas
socket.on('audio_waveform', function (msg) {
    const chunk = msg.data;
    dataBuffer.push(...chunk);
    if (dataBuffer.length > maxSamples) {
        dataBuffer.splice(0, dataBuffer.length - maxSamples);
    }
});

// 2. Start Microphone and tell server to start recording
startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    stopBtn.disabled = false;

    try {
        // Initialize audio stream if it doesn't exist yet
        if (!stream) {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            // Force the sample rate to match Python config (44.1kHz)
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
            const source = audioContext.createMediaStreamSource(stream);
            processor = audioContext.createScriptProcessor(512, 1, 1);

            source.connect(processor);
            processor.connect(audioContext.destination);

            processor.onaudioprocess = function (e) {
                const inputData = e.inputBuffer.getChannelData(0);
                socket.emit('mic_data', { data: Array.from(inputData) });
            };
        } else if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        // Alert Python backend to begin writing incoming frames to the buffer
        socket.emit('start_recording');

    } catch (err) {
        console.error('Mic access failed:', err);
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }
});

// 3. Stop recording session and prompt Python to write the WAV file
stopBtn.addEventListener('click', async () => {
    startBtn.disabled = false;
    stopBtn.disabled = true;

    if (audioContext) {
        await audioContext.suspend();
    }

    // Tell Python to finalize the WAV write cycle
    socket.emit('stop_recording');
});

// 4. Animation Frame Canvas Loop
function draw() {
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const sliceWidth = canvas.width / maxSamples;
    let x = 0;

    for (let i = 0; i < dataBuffer.length; i++) {
        const v = dataBuffer[i] * 4.0;
        const y = (canvas.height / 2) + (v * (canvas.height / 2));

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        x += sliceWidth;
    }
    ctx.stroke();
}

draw();