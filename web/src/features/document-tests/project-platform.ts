export type ProjectPlatform = 'pc-web' | 'mobile-web' | 'wecom-workbench';

export const projectPlatformOptions: Array<{ value: ProjectPlatform; label: string }> = [
  { value: 'pc-web', label: 'PC 网页' },
  { value: 'mobile-web', label: '移动网页' },
  { value: 'wecom-workbench', label: '企微工作台' },
];

/** Build the explicit surface selection sent with a new/imported project. */
export function projectPlatformSelection(platform: ProjectPlatform): { platform: ProjectPlatform } {
  return { platform };
}
