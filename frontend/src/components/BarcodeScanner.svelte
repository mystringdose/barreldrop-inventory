<script>
  import { onDestroy } from "svelte";

  export let onDetect = () => {};

  let videoEl;
  let stream;
  let running = false;
  let error = "";
  let detector;

  async function start() {
    error = "";
    if (!("BarcodeDetector" in window)) {
      error = "Barcode scanning is not supported on this device.";
      return;
    }

    try {
      detector = new BarcodeDetector({ formats: ["code_128", "ean_13", "ean_8", "upc_a", "upc_e"] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      videoEl.srcObject = stream;
      await videoEl.play();
      running = true;
      scanLoop();
    } catch (err) {
      error = err.message || "Unable to access camera";
    }
  }

  function stop() {
    running = false;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    stream = null;
  }

  async function scanLoop() {
    if (!running || !detector || !videoEl) return;
    try {
      const barcodes = await detector.detect(videoEl);
      if (barcodes.length > 0) {
        const code = barcodes[0].rawValue;
        onDetect(code);
        stop();
        return;
      }
    } catch (err) {
      // keep trying
    }

    requestAnimationFrame(scanLoop);
  }

  onDestroy(() => stop());
</script>

<div class="border rounded p-3 bg-slate-50">
  <div class="flex items-center justify-between">
    <p class="text-sm text-slate-600">Barcode Scanner</p>
    {#if !running}
      <button class="text-xs border rounded px-2 py-1" on:click={start}>Start</button>
    {:else}
      <button class="text-xs border rounded px-2 py-1" on:click={stop}>Stop</button>
    {/if}
  </div>

  {#if error}
    <p class="text-xs text-rose-600 mt-2">{error}</p>
  {/if}

  <video bind:this={videoEl} class="mt-2 w-full rounded" playsinline></video>
</div>
