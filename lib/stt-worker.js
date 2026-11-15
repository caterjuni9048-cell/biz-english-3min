// 폰 안에서 도는 음성 인식(Whisper tiny.en). 정답 문장을 앞 문맥으로 넣어 발음이 서툴러도 잘 받아 적게 한다.
import {AutoTokenizer, AutoProcessor, WhisperForConditionalGeneration, env} from './transformers.min.js';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('../models/', import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = new URL('./', import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;

const MID = 'whisper-tiny.en';
let tok, proc, model, loading = null;

function load() {
  if (!loading) {
    const cb = p => { if (p.status === 'progress') postMessage({type: 'progress', file: p.file, loaded: p.loaded, total: p.total}); };
    loading = (async () => {
      tok = await AutoTokenizer.from_pretrained(MID, {progress_callback: cb});
      proc = await AutoProcessor.from_pretrained(MID, {progress_callback: cb});
      model = await WhisperForConditionalGeneration.from_pretrained(MID, {
        dtype: {encoder_model: 'q8', decoder_model_merged: 'q8'}, device: 'wasm', progress_callback: cb,
      });
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      await load();
      postMessage({type: 'ready'});
    } else if (m.type === 'run') {
      await load();
      const inputs = await proc(m.audio);
      const gc = model.generation_config;
      let init = [gc.decoder_start_token_id, gc.no_timestamps_token_id];
      if (m.prompt) {
        const p = tok.encode(' ' + m.prompt, {add_special_tokens: false});
        init = [gc.prev_sot_token_id, ...p, ...init];
      }
      const out = await model.generate({...inputs, decoder_input_ids: init, max_new_tokens: 60});
      const ids = Array.from(out.tolist()[0]).map(Number).slice(init.length);
      postMessage({type: 'result', id: m.id, text: tok.decode(ids, {skip_special_tokens: true}).trim()});
    }
  } catch (err) {
    postMessage({type: 'error', id: m.id ?? null, message: String((err && err.message) || err)});
  }
};
