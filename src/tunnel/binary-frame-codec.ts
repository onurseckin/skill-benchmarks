import {
  CHANNEL_TO_CODE,
  CODE_TO_CHANNEL,
  FRAME_HEADER_LENGTH,
  FRAME_HEADER_MAGIC,
  FRAME_HEADER_VERSION,
  type BinaryFrameEnvelope,
  type StreamChannel,
  type StreamChannelCode,
} from "./types.js";

export function encodeBinaryFrame(
  channel: StreamChannel,
  sequence: number,
  timestamp: number,
  payload: Uint8Array,
): Uint8Array {
  const totalLength = FRAME_HEADER_LENGTH + payload.byteLength;
  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint16(0, FRAME_HEADER_MAGIC, false);
  view.setUint8(2, FRAME_HEADER_VERSION);
  view.setUint8(3, CHANNEL_TO_CODE[channel]);
  view.setUint32(4, sequence, false);
  view.setFloat64(8, timestamp, false);
  buffer.set(payload, FRAME_HEADER_LENGTH);
  return buffer;
}

export function decodeBinaryFrame(data: Uint8Array): BinaryFrameEnvelope | null {
  if (data.byteLength < FRAME_HEADER_LENGTH) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = view.getUint16(0, false);
  if (magic !== FRAME_HEADER_MAGIC) return null;
  const version = view.getUint8(2);
  const channelCode = view.getUint8(3) as StreamChannelCode;
  const channel = CODE_TO_CHANNEL[channelCode];
  if (!channel) return null;
  const sequence = view.getUint32(4, false);
  const timestamp = view.getFloat64(8, false);
  const payload = data.subarray(FRAME_HEADER_LENGTH);
  return {
    magic,
    version,
    channel,
    channelCode,
    sequence,
    timestamp,
    payloadLength: payload.byteLength,
    payload,
  };
}
