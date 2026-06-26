import type { WorkbenchCommand } from "./commands";

export type VoiceParseOptions = {
  requireWakeWord?: boolean;
  wakeWords?: string[];
  defaultStepSeconds?: number;
};

export type VoiceParseResult = {
  command: WorkbenchCommand;
  normalizedTranscript: string;
  wakeWord: string | null;
  destructive: boolean;
};

const DEFAULT_WAKE_WORDS = ["工作台", "标注助手", "yolo", "workbench"];
const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

function normalizeTranscript(value: string) {
  return value
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:：]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseChineseInteger(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  if (text === "十") return 10;
  if (text.includes("十")) {
    const [left, right] = text.split("十", 2);
    const tens = left ? CHINESE_DIGITS[left] : 1;
    const ones = right ? CHINESE_DIGITS[right] : 0;
    if (tens == null || ones == null) return null;
    return tens * 10 + ones;
  }
  if (text.length === 1 && CHINESE_DIGITS[text] != null) return CHINESE_DIGITS[text];
  return null;
}

function parseNumberToken(value: string): number | null {
  const normalized = value.trim().replace(/秒|帧|类|类别/g, "");
  if (!normalized) return null;
  const direct = Number(normalized);
  if (Number.isFinite(direct)) return direct;
  return parseChineseInteger(normalized);
}

function extractWakeWord(transcript: string, wakeWords: string[]) {
  for (const wakeWord of wakeWords) {
    const index = transcript.indexOf(wakeWord.toLowerCase());
    if (index < 0) continue;
    const commandText = `${transcript.slice(0, index)} ${transcript.slice(index + wakeWord.length)}`
      .replace(/\s+/g, " ")
      .trim();
    return { wakeWord, commandText };
  }
  return { wakeWord: null, commandText: transcript };
}

function seekAmount(text: string, fallback: number) {
  const explicit = text.match(/(?:向前|往前|后退|向后|往后|前进|跳过|seek|forward|back(?:ward)?)\s*([\d.]+|[零〇一二两三四五六七八九十]+)\s*(?:秒|second|seconds)?/i);
  if (!explicit) return fallback;
  const value = parseNumberToken(explicit[1]);
  return value != null && value > 0 ? value : fallback;
}

export function parseVoiceCommand(
  transcript: string,
  options: VoiceParseOptions = {}
): VoiceParseResult | null {
  const normalizedTranscript = normalizeTranscript(transcript);
  if (!normalizedTranscript) return null;
  const wakeWords = options.wakeWords?.length ? options.wakeWords : DEFAULT_WAKE_WORDS;
  const extracted = extractWakeWord(normalizedTranscript, wakeWords);
  if (options.requireWakeWord !== false && !extracted.wakeWord) return null;
  const text = extracted.commandText;
  const defaultStep = Math.max(0.001, options.defaultStepSeconds ?? 0.1);

  let command: WorkbenchCommand | null = null;
  let destructive = false;

  if (/^(?:开始|启用|打开).*(?:控制|监听)|(?:arm|enable|start).*(?:control|listening)/i.test(text)) {
    command = { type: "controls.arm" };
  } else if (/^(?:停止|关闭|暂停).*(?:控制|监听)|(?:disarm|disable|stop).*(?:control|listening)/i.test(text)) {
    command = { type: "controls.disarm" };
  } else if (/(?:复制|拷贝).*(?:上一|前一).*(?:框|标注)|copy.*(?:previous|last).*(?:box|label)/i.test(text)) {
    command = { type: "video.copyPreviousBoxes" };
  } else if (/(?:标记|设为|这是).*(?:空帧|空画面|没有目标)|(?:空帧|没有目标).*(?:确认|完成)?|mark.*(?:empty|reviewed)/i.test(text)) {
    command = { type: "video.markReviewed" };
  } else if (/(?:清除|删除).*(?:当前|这一).*(?:帧|标注|记录)|clear.*(?:current|frame).*(?:record|label)?/i.test(text)) {
    command = { type: "video.clearFrameRecord" };
    destructive = true;
  } else {
    const classMatch = text.match(/(?:选择|切换到?|设为)\s*(?:类别|类|class)\s*([\d]+|[零〇一二两三四五六七八九十]+)/i) ||
      text.match(/(?:类别|类|class)\s*([\d]+|[零〇一二两三四五六七八九十]+)/i);
    if (classMatch) {
      const classId = parseNumberToken(classMatch[1]);
      if (classId != null && classId >= 0) command = { type: "video.selectClass", classId: Math.trunc(classId) };
    }
  }

  if (!command) {
    const isPrevious = /上一帧|前一帧|往前|向前|后退|previous frame|go back|backward/i.test(text);
    const isNext = /下一帧|后一帧|往后|向后|前进|next frame|go forward|forward/i.test(text);
    if (isPrevious && !isNext) command = { type: "video.seekBy", seconds: -seekAmount(text, defaultStep) };
    else if (isNext && !isPrevious) command = { type: "video.seekBy", seconds: seekAmount(text, defaultStep) };
  }

  if (!command) return null;
  return {
    command,
    normalizedTranscript,
    wakeWord: extracted.wakeWord,
    destructive
  };
}
