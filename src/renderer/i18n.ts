import { createContext, useContext } from 'react'

/**
 * Minimal dependency-free UI localization.
 *
 * Start small and explicit: professional film/camera terminology is curated,
 * not machine-translated. Data/model ids stay language-neutral.
 */
export type UiLanguage = 'en' | 'ru'

export const EN = {
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
  visualMemory: 'Visual Memory',
  projectCheckpoints: 'Project checkpoints',
  close: 'Close',
  restore: 'Restore',
  noCheckpoints: 'No checkpoints yet.',
  workspaceMissing: 'Workspace not selected yet',
  interfaceLanguage: 'Interface language'
} as const

export const RU: Record<keyof typeof EN, string> = {
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
  visualMemory: 'Визуальная история',
  projectCheckpoints: 'Контрольные точки проекта',
  close: 'Закрыть',
  restore: 'Восстановить',
  noCheckpoints: 'Контрольных точек пока нет.',
  workspaceMissing: 'Хранилище ещё не выбрано',
  interfaceLanguage: 'Язык интерфейса'
}

export type UiKey = keyof typeof EN

export function uiText(language: UiLanguage, key: UiKey): string {
  return language === 'ru' ? RU[key] : EN[key]
}

export const LanguageContext = createContext<UiLanguage>('en')

export function useUiLanguage(): UiLanguage {
  return useContext(LanguageContext)
}
