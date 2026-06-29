function classColorHue(classId: number) {
  const id = Number.isInteger(classId) && classId >= 0 ? classId : 0;
  return Math.round((id * 137.508 + 29) % 360);
}

export function classBoxColor(classId: number, selected = false) {
  const hue = classColorHue(classId);
  return `hsl(${hue} 82% ${selected ? 56 : 48}%)`;
}
