import type { SignalClass } from '../model/types'

export const SIGNAL_CLASSES: { value: SignalClass; label: string }[] = [
  { value: 'power', label: 'Power' },
  { value: 'ground', label: 'Ground' },
  { value: 'data', label: 'Data' },
  { value: 'shield', label: 'Shield' },
  { value: 'nc', label: 'No Connect' }
]

export function signalColor(cls: SignalClass | undefined): string {
  switch (cls) {
    case 'power':
      return '#e5484d'
    case 'ground':
      return '#8b8f98'
    case 'data':
      return '#5b9bff'
    case 'shield':
      return '#c48a2f'
    case 'nc':
      return '#4a4f5a'
    default:
      return '#7a808c'
  }
}
