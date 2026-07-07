/**
 * 저장소 이름/경로 같은 문자열에서 결정적인 아바타 색상을 만든다.
 * 같은 입력은 항상 같은 색을 반환하므로, 저장소마다 고유하게 구별되는
 * 이니셜 아바타 배경을 렌더링할 수 있다.
 */

/** djb2 문자열 해시 — 간단하고 분포가 고른 결정적 해시 */
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

export interface AvatarColor {
  background: string;
  foreground: string;
}

/**
 * seed로부터 HSL 배경색과 대비되는 전경색을 만든다.
 * 채도/명도를 고정해 라이트·다크 테마 모두에서 읽히도록 한다.
 */
export function avatarColor(seed: string): AvatarColor {
  const hue = hashString(seed) % 360;
  return {
    background: `hsl(${hue}, 55%, 45%)`,
    foreground: "hsl(0, 0%, 100%)",
  };
}

/** 저장소 이름에서 이니셜 1글자를 뽑는다. */
export function avatarInitial(name: string): string {
  return (name.trim().charAt(0) || "?").toUpperCase();
}
