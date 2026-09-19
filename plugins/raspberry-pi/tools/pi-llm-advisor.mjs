import { resolveState, resolveBoardRam, recordAdvisory } from './lib.mjs';
import { resolveSpec } from './board-specs.mjs';

const USE_CASES = ['chat', 'rag', 'coding', 'voice_assistant'];
const CONTEXT_PREFS = ['short', 'long'];

const GPU_NOTE = 'Pi 5 has no GPU/NPU acceleration path for LLM inference — the VideoCore VII GPU does not do general matmul, so inference is CPU-bound on the 4 BCM2712 Cortex-A76 cores. Expect modest, not fast, throughput at every tier.';

function recommend(ramGb, useCase, contextPref) {
  if (ramGb <= 2) {
    return {
      viable: false,
      model_size_class: null,
      quantization: null,
      runtime: null,
      context_window_tokens: null,
      storage_advice: null,
      swap_advice: null,
      notes: [
        `${ramGb}GB is not enough headroom for a local LLM alongside the OS — even a small quantized model plus context needs more than this tier leaves free.`,
        'Recommend cloud/remote inference (call out to a hosted API) instead of running a model on this board.',
        GPU_NOTE,
      ],
    };
  }
  if (ramGb === 4) {
    return {
      viable: true,
      model_size_class: '~1-2B parameters',
      quantization: 'Q4_K_M',
      runtime: 'llama.cpp',
      context_window_tokens: contextPref === 'long' ? 2048 : 1024,
      storage_advice: 'microSD is fine — model file is small enough not to need NVMe.',
      swap_advice: 'Add 1-2GB of zram or swap; run headless (no desktop) to keep RAM free for the model.',
      notes: ['Tight fit — expect short responses and modest throughput.', GPU_NOTE],
    };
  }
  if (ramGb === 8) {
    return {
      viable: true,
      model_size_class: useCase === 'coding' ? '7-8B parameters' : '3-8B parameters',
      quantization: 'Q4_K_M or Q5_K_M',
      runtime: 'Ollama or llama.cpp',
      context_window_tokens: contextPref === 'long' ? 8192 : 4096,
      storage_advice: 'microSD works for a single model; if you plan to keep several models around, an NVMe drive over the PCIe 2.0 x1 interface (needs a separate M.2 HAT) gives more headroom and faster load times.',
      swap_advice: 'A few GB of zram or swap recommended for the larger end of this range, especially with long-context prompts.',
      notes: [GPU_NOTE],
    };
  }
  // 16GB and above
  return {
    viable: true,
    model_size_class: '~8B comfortably; 13B possible at aggressive quantization',
    quantization: 'Q4_K_M (13B) or Q5_K_M/Q6_K (8B)',
    runtime: 'Ollama or llama.cpp',
    context_window_tokens: contextPref === 'long' ? 16384 : 8192,
    storage_advice: 'NVMe over the PCIe 2.0 x1 interface (separate M.2 HAT required) recommended if you keep multiple models loaded or use long-context RAG.',
    swap_advice: 'Usually unnecessary at this tier for a single model.',
    notes: ['Best local-LLM experience on Pi 5, but still CPU-bound — do not expect desktop-GPU-class throughput.', GPU_NOTE],
  };
}

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const useCase = USE_CASES.includes(args.use_case) ? args.use_case : 'chat';
  const contextPref = CONTEXT_PREFS.includes(args.context_length_pref) ? args.context_length_pref : 'short';
  const { board, ramGb } = resolveBoardRam(state, args);

  const spec = resolveSpec(ramGb);
  const recommendation = recommend(ramGb, useCase, contextPref);
  const rationale = `Based on the Pi 5 ${spec.ram_gb}GB tier (${spec.cpu}; ${spec.pcie}) for a "${useCase}" workload with a "${contextPref}" context preference.`;

  const advisoryId = recordAdvisory(state, {
    boardId: board ? board.id : null,
    advisor: 'llm_builder',
    workload: useCase,
    ramGb,
    inputs: { use_case: useCase, context_length_pref: contextPref },
    recommendation,
    rationale,
  });

  return {
    success: true,
    output: {
      board_id: board ? board.id : null,
      ram_gb: ramGb,
      use_case: useCase,
      recommendation,
      rationale,
      advisory_id: advisoryId,
    },
  };
}
