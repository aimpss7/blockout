/**
 * Minimal dependency-free UI localization.
 *
 * Start small and explicit: professional film/camera terminology is curated,
 * not machine-translated. Data/model ids stay language-neutral.
 */
export type UiLanguage = 'en' | 'ru'

const EN = {
  stage: 'STAGE',
  shoot: 'SHOOT',
  deliver: 'DELIVER',
  save: 'Save',
  checkpoint: 'Checkpoint',
  history: 'History',
  help: 'Help',
  newProject: 'New Project',
  openProject: 'Open Project…',
  tutorial: 'Tutorial',
  workspace: 'Workspace',
  changeWorkspace: 'Change Workspace…',
  directorCamera: 'Director camera',
  advancedCamera: 'Advanced camera',
  focalLength: 'Focal length',
  exactFocal: 'Exact focal length',
  sensor: 'Sensor',
  heroFrame: 'Hero Frame',
  references: 'References',
  visualMemory: 'Visual Memory'
} as const

const RU: Record<keyof typeof EN, string> = {
  stage: 'СЦЕНА',
  shoot: 'СЪЁМКА',
  deliver: 'ЭКСПОРТ',
  save: 'Сохранить',
  checkpoint: 'Контрольная точка',
  history: 'История',
  help: 'Справка',
  newProject: 'Новый проект',
  openProject: 'Открыть проект…',
  tutorial: 'Обучение',
  workspace: 'Хранилище',
  changeWorkspace: 'Сменить хранилище…',
  directorCamera: 'Режиссёрская камера',
  advancedCamera: 'Расширенные настройки камеры',
  focalLength: 'Фокусное расстояние',
  exactFocal: 'Точное фокусное расстояние',
  sensor: 'Сенсор',
  heroFrame: 'Ключевой кадр',
  references: 'Референсы',
  visualMemory: 'Визуальная история'
}

export type UiKey = keyof typeof EN

export function uiText(language: UiLanguage, key: UiKey): string {
  return language === 'ru' ? RU[key] : EN[key]
}
