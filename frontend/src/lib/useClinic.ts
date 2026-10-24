import { useQuery } from '@tanstack/react-query'
import { get } from '../api/client'
import type { Clinic, Professional } from '../api/types'
import { hasHours, type WeekHours } from './tz'

/** Dados da clínica (fuso e expediente) — lidos por toda a agenda. */
export const useClinic = () => useQuery({ queryKey: ['clinic'], queryFn: () => get<Clinic>('/clinic'), staleTime: 5 * 60_000 })
export const useProfessionals = () => useQuery({ queryKey: ['professionals'], queryFn: () => get<Professional[]>('/professionals') })

/** Horário de atendimento efetivo: o do profissional, ou o expediente da clínica se ele não tiver um próprio. */
export const hoursOf = (p: Professional | undefined, clinicHours: WeekHours | undefined): WeekHours | undefined =>
  p && hasHours(p.workHours) ? p.workHours : clinicHours
