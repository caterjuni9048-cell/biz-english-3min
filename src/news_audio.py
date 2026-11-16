"""오늘의 뉴스 음성 만들기: python3 src/news_audio.py news/2026-11-16.json
- 음성 AI(Kokoro-82M, af_heart 목소리)를 처음 한 번 huggingface.co 에서 받아 ~/.cache/bizeng-kokoro 에 둔다.
- 결과: news/audio/<날짜>.mp3
"""
import sys, os, json, subprocess, urllib.request
import numpy as np
D = os.path.expanduser('~/.cache/bizeng-kokoro')
B = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main'

def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 1000: return
    tmp = path + '.part'
    subprocess.run(['curl', '-sSLf', '-m', '600', '--retry', '3', '-o', tmp, url], check=True)
    os.replace(tmp, path)

def main(jpath):
    os.makedirs(D, exist_ok=True)
    get(B + '/onnx/model_quantized.onnx', D + '/model_q8.onnx')
    get(B + '/voices/af_heart.bin', D + '/af_heart.bin')
    if not os.path.exists(D + '/voices.npz'):
        v = np.fromfile(D + '/af_heart.bin', dtype=np.float32).reshape(-1, 1, 256)
        np.savez(D + '/voices.npz', af_heart=v)
    import soundfile as sf
    from kokoro_onnx import Kokoro
    k = Kokoro(D + '/model_q8.onnx', D + '/voices.npz')
    n = json.load(open(jpath, encoding='utf-8'))
    parts = []
    for para in [n['title']] + n['paras']:
        s, sr = k.create(para, voice='af_heart', speed=0.9, lang='en-us')
        s = s / max(1e-6, float(abs(s).max())) * 0.85
        parts += [s.astype(np.float32), np.zeros(int(sr * 0.6), np.float32)]
    root = os.path.dirname(os.path.dirname(os.path.abspath(jpath)))
    os.makedirs(root + '/news/audio', exist_ok=True)
    wav = D + '/tmp.wav'; mp3 = root + '/news/audio/' + n['date'] + '.mp3'
    sf.write(wav, np.concatenate([np.zeros(int(sr * 0.15), np.float32)] + parts), sr)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-ar', '24000', '-b:a', '48k', mp3], check=True)
    print('audio:', mp3, os.path.getsize(mp3), 'bytes')

if __name__ == '__main__':
    main(sys.argv[1])
