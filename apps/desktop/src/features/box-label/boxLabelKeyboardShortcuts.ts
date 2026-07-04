export const KEYBOARD_STEP_MULTIPLIERS = [1, 3, 7, 9] as const;
export type KeyboardStepMultiplier = (typeof KEYBOARD_STEP_MULTIPLIERS)[number];

export function keyboardMultiplierForNumpad(code: string): KeyboardStepMultiplier | null {
  const match = code.match(/^Numpad([1379])$/);
  if (!match) return null;
  return Number(match[1]) as KeyboardStepMultiplier;
}

export function isNumpadCode(code: string) {
  return /^Numpad/.test(code);
}

export function numpadResizeKey(code: string) {
  const match = code.match(/^Numpad([24568])$/);
  return match ? match[1] : null;
}
