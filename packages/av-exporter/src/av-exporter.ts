import fixWebmDur from 'fix-webm-duration'
import MuxMP4Worker from './mux-mp4-worker?worker&inline'
import { IEncoderConf } from './types'

/**
 * 导出 WebM 格式的视频，
 * 相较于 MediaRecorder 解决了视频 duration 问题
 * @param inputMediaStream: MediaStream
 *  example: AVCanvas.captureStream()
 * @param recordOpts MediaRecorderOptions
 * @returns Promise<() => void> stop recording
 */
export async function exportWebM (
  inputMediaStream: MediaStream,
  outputWriter: FileSystemWritableFileStream,
  recordOpts: MediaRecorderOptions = {}
): Promise<() => void> {
  const recoder = new MediaRecorder(inputMediaStream, {
    ...recordOpts,
    mimeType: 'video/webm;codecs=avc1.64001f,opus'
  })
  let firstBlob: Blob | null = null
  recoder.ondataavailable = async (evt) => {
    if (firstBlob == null) firstBlob = evt.data
    await outputWriter.write(evt.data)
  }
  const startTime = performance.now()
  recoder.onstop = async () => {
    if (firstBlob != null) {
      const duration = performance.now() - startTime
      const fixedBlob = await fixWebmDur(firstBlob, duration)
      await outputWriter.seek(0)
      await outputWriter.write(fixedBlob)
    }
    await outputWriter.close()
  }
  recoder.start(1000)
  return () => {
    recoder.stop()
  }
}

export function exportMP4 (
  ms: MediaStream,
  opts: Omit<IEncoderConf, 'videoFrameStream'>,
  onData: (stream: ReadableStream) => void
): () => void {
  const worker = new MuxMP4Worker()
  const tracks = ms.getVideoTracks()
  const trackProcessor = new MediaStreamTrackProcessor({
    track: tracks[0]
  })
  const videoFrameStream = trackProcessor.readable
  worker.postMessage({
    type: 'start',
    data: {
      fps: opts.fps ?? 30,
      width: opts.width,
      height: opts.height,
      videoFrameStream
    }
  }, [videoFrameStream])

  worker.onmessage = async (evt: MessageEvent) => {
    const { type, data } = evt.data
    switch (type) {
      case 'outputStream':
        onData(data)
        break
    }
  }
  return () => {
    worker.postMessage({
      type: 'stop'
    })
    setTimeout(() => {
      worker.terminate()
    }, 1000)
  }
}
