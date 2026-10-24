import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Link2, MailPlus, Pencil, ShieldCheck, Trash2, UserX } from 'lucide-react'
import { useState } from 'react'
import { ApiError, del, get, patch, post, put } from '../../api/client'
import type { Invitation, Member, PermCatalog, Role, Team } from '../../api/types'
import { Badge } from '../../ui/Badge'
import { Button, IconButton } from '../../ui/Button'
import { Checkbox, Switch } from '../../ui/Choice'
import { Avatar, Card, Skeleton, useToast } from '../../ui/Feedback'
import { Field, Input, EnterSubmits } from '../../ui/Field'
import { ConfirmDialog, Drawer, Modal } from '../../ui/Overlay'
import { cn } from '../../ui/cn'
import { HoursEditor, hoursProblem } from '../../domain/HoursEditor'
import { hasHours, type WeekHours } from '../../lib/tz'
import { useClinic, useProfessionals } from '../../lib/useClinic'
import { COLOR_NAMES } from './RecordsSettings'
import { SettingsLayout } from './SettingsLayout'

const ROLE_LABEL: Record<Role, string> = { owner: 'Dono', dentist: 'Dentista', secretary: 'Recepção', custom: 'Personalizado' }
const ROLE_HINT: Record<Exclude<Role, 'owner'>, string> = {
  dentist: 'Atende, monta orçamentos e lança tratamentos. Vê só a própria agenda.',
  secretary: 'Cuida da agenda de todos, cadastros e recebimentos.',
  custom: 'Começa sem nenhuma permissão: marque só o que a pessoa precisa.',
}
const LABEL_SWATCH = ['1', '2', '3', '4', '5', '6', '7', '8']
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : 'nunca')

/** S29 — Equipe, convites e permissões. */
export function TeamSettings() {
  const team = useQuery({ queryKey: ['team'], queryFn: () => get<Team>('/team') })
  const catalog = useQuery({ queryKey: ['perm-catalog'], queryFn: () => get<PermCatalog>('/settings/permissions'), staleTime: Infinity })
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)

  return (
    <SettingsLayout
      title="Equipe e permissões"
      description="Convide quem trabalha com você e escolha o que cada pessoa pode ver e fazer. Mudanças valem na hora."
      actions={<Button icon={<MailPlus className="size-4" />} onClick={() => setInviting(true)}>Convidar pessoa</Button>}
    >
      {team.isLoading && <Skeleton className="h-40 w-full" />}
      {team.isError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Não foi possível carregar a equipe.</p>}
      {team.data && (
        <div className="flex flex-col gap-6">
          <Card>
            <ul className="divide-y divide-border">
              {team.data.members.map((m) => (
                <li key={m.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', !m.isActive && 'opacity-60')}>
                  <Avatar name={m.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.name}{m.isMe && <span className="text-text-muted"> (você)</span>}</p>
                    <p className="truncate text-xs text-text-muted">{m.email} · último acesso {fmtDate(m.lastLoginAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
                    {m.doesAttend && <Badge tone="info">Atende</Badge>}
                    {!m.isActive && <Badge tone="danger">Desativado</Badge>}
                  </div>
                  <IconButton label={`Editar ${m.name}`} onClick={() => setEditing(m)}><Pencil className="size-4" /></IconButton>
                </li>
              ))}
            </ul>
          </Card>
          <section aria-labelledby="inv-h">
            <h3 id="inv-h" className="mb-2 text-sm font-semibold">Convites pendentes</h3>
            {team.data.invitations.length === 0
              ? <p className="text-sm text-text-muted">Nenhum convite aguardando.</p>
              : <InvitationList items={team.data.invitations} />}
          </section>
        </div>
      )}
      {inviting && catalog.data && <InviteModal catalog={catalog.data} onClose={() => setInviting(false)} />}
      {editing && catalog.data && <MemberDrawer member={editing} catalog={catalog.data} onClose={() => setEditing(null)} />}
    </SettingsLayout>
  )
}

function InvitationList({ items }: { items: Invitation[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [revoking, setRevoking] = useState<Invitation | null>(null)
  const revoke = useMutation({
    mutationFn: (i: Invitation) => del(`/team/invitations/${i.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team'] }); setRevoking(null); toast('success', 'Convite cancelado. O link deixou de valer.') },
  })
  return (
    <Card>
      <ul className="divide-y divide-border">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <Link2 aria-hidden className="size-4 text-text-muted" />
            <span className="min-w-0 flex-1 truncate">{i.name ? `${i.name} · ` : ''}{i.email}</span>
            <Badge>{ROLE_LABEL[i.role]}</Badge>
            <span className="text-xs text-text-muted">vence em {new Date(i.expiresAt).toLocaleDateString('pt-BR')}</span>
            <IconButton label={`Cancelar convite de ${i.email}`} onClick={() => setRevoking(i)}><Trash2 className="size-4" /></IconButton>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2 text-xs text-text-muted">
        Perdeu o link? Convide o mesmo e-mail de novo: um link novo é gerado e o antigo deixa de funcionar.
      </p>
      {revoking && (
        <ConfirmDialog open onOpenChange={(v) => !v && setRevoking(null)} title="Cancelar este convite?"
          body={<>O link enviado para <strong>{revoking.email}</strong> deixa de funcionar.</>}
          confirmLabel="Cancelar convite" loading={revoke.isPending} onConfirm={() => revoke.mutate(revoking)} />
      )}
    </Card>
  )
}

/** Lista de permissões agrupada, com "marcar o grupo todo". */
function PermissionPicker({ catalog, value, onChange, disabled }: { catalog: PermCatalog; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const toggle = (code: string, on: boolean) => onChange(on ? [...new Set([...value, code])] : value.filter((c) => c !== code))
  return (
    <div className="flex flex-col gap-4">
      {catalog.groups.map((g) => {
        const codes = g.perms.map((p) => p.code)
        const n = codes.filter((c) => value.includes(c)).length
        return (
          <fieldset key={g.key} className="rounded-md border border-border p-3">
            <legend className="px-1">
              <Checkbox
                label={`${g.label} (${n}/${codes.length})`}
                checked={n === 0 ? false : n === codes.length ? true : 'indeterminate'}
                disabled={disabled}
                onCheckedChange={(on) => onChange(on ? [...new Set([...value, ...codes])] : value.filter((c) => !codes.includes(c)))}
              />
            </legend>
            <div className="mt-1 flex flex-col gap-2 pl-6">
              {g.perms.map((p) => (
                <div key={p.code}>
                  <Checkbox label={p.label} checked={value.includes(p.code)} disabled={disabled} onCheckedChange={(on) => toggle(p.code, on)} />
                  {p.hint && <p className="ml-6 text-xs text-text-muted">{p.hint}</p>}
                </div>
              ))}
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}

function RolePicker({ value, onChange }: { value: Exclude<Role, 'owner'>; onChange: (r: Exclude<Role, 'owner'>) => void }) {
  return (
    <div role="radiogroup" aria-label="Papel" className="grid gap-2 sm:grid-cols-3">
      {(['dentist', 'secretary', 'custom'] as const).map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          className={cn('rounded-md border p-3 text-left', value === r ? 'border-accent bg-accent-soft' : 'border-border-strong hover:bg-surface')}
        >
          <span className="flex items-center gap-1.5 text-sm font-semibold">{value === r && <Check aria-hidden className="size-4 text-accent-text" />}{ROLE_LABEL[r]}</span>
          <span className="mt-1 block text-xs text-text-muted">{ROLE_HINT[r]}</span>
        </button>
      ))}
    </div>
  )
}

function InviteModal({ catalog, onClose }: { catalog: PermCatalog; onClose: () => void }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('dentist')
  const [attends, setAttends] = useState(true)
  const [perms, setPerms] = useState<string[]>(catalog.presets.dentist)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const send = useMutation({
    mutationFn: () => post<{ token: string }>('/team/invitations', { email, name: name || undefined, role, permissions: perms, doesAttend: attends }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['team'] }); setLink(`${window.location.origin}/convite/${r.token}`) },
  })
  const pickRole = (r: Exclude<Role, 'owner'>) => { setRole(r); setPerms(catalog.presets[r]); setAttends(r === 'dentist') }
  const copy = async () => { if (link) { await navigator.clipboard.writeText(link); setCopied(true) } }

  if (link) {
    return (
      <Modal open onOpenChange={(v) => !v && onClose()} title="Convite criado" description={`Envie este link para ${email}. Ele vale por 7 dias e só pode ser usado uma vez.`}
        footer={<Button onClick={onClose}>Concluir</Button>}>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input readOnly value={link} aria-label="Link do convite" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="secondary" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={copy}>{copied ? 'Copiado' : 'Copiar'}</Button>
          </div>
          <a className="text-sm font-semibold text-accent-text underline" target="_blank" rel="noreferrer"
            href={`https://wa.me/?text=${encodeURIComponent(`Oi! Este é o seu acesso ao sistema da clínica: ${link}`)}`}>
            Enviar pelo WhatsApp
          </a>
          <p className="text-xs text-text-muted">Por segurança, este link não aparece de novo. Se perder, convide o mesmo e-mail outra vez.</p>
        </div>
      </Modal>
    )
  }
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title="Convidar pessoa" size="lg"
      description="A pessoa recebe um link para criar a senha e entrar direto na sua clínica."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={send.isPending} disabled={!email.includes('@')} onClick={() => send.mutate()}>Gerar convite</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (email.includes('@')) send.mutate() }}>
        <EnterSubmits />
        {send.isError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{send.error instanceof ApiError ? send.error.message : 'Não foi possível convidar.'}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="E-mail" required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus /></Field>
          <Field label="Nome (opcional)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <RolePicker value={role} onChange={pickRole} />
        <Switch label="Atende pacientes (ganha uma agenda própria)" checked={attends} onCheckedChange={setAttends} />
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold"><ShieldCheck aria-hidden className="mr-1 inline size-4" />Permissões ({perms.length}) — ajustar</summary>
          <div className="mt-3"><PermissionPicker catalog={catalog} value={perms} onChange={setPerms} /></div>
        </details>
      </form>
    </Modal>
  )
}

function MemberDrawer({ member, catalog, onClose }: { member: Member; catalog: PermCatalog; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const isOwner = member.role === 'owner'
  const [role, setRole] = useState<Exclude<Role, 'owner'>>(isOwner ? 'custom' : (member.role as Exclude<Role, 'owner'>))
  const [perms, setPerms] = useState(member.permissions)
  const [attends, setAttends] = useState(member.doesAttend)
  const [color, setColor] = useState(member.color ?? '1')
  const [cro, setCro] = useState(member.cro ?? '')
  const [specialty, setSpecialty] = useState(member.specialty ?? '')
  const [confirmOff, setConfirmOff] = useState(false)
  const clinic = useClinic()
  const pros = useProfessionals()
  const current = pros.data?.find((p) => p.id === member.id)
  const [own, setOwn] = useState<boolean | null>(null)
  const [hours, setHours] = useState<WeekHours | null>(null)
  const ownHours = own ?? hasHours(current?.workHours)
  const shownHours = hours ?? (hasHours(current?.workHours) ? current!.workHours : clinic.data?.businessHours ?? {})
  const save = useMutation({
    mutationFn: async (body: object) => {
      const m = await patch<Member>(`/team/${member.id}`, body)
      // horário só vale para quem atende; "segue a clínica" = horário vazio
      if (m.doesAttend && m.isActive && (own !== null || hours !== null)) {
        await put(`/team/${member.id}/work-hours`, { workHours: ownHours ? shownHours : {} })
      }
      return m
    },
    onSuccess: (m) => { qc.invalidateQueries({ queryKey: ['team'] }); qc.invalidateQueries({ queryKey: ['professionals'] }); toast('success', `${m.name} atualizado.`); onClose() },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  })
  const body = isOwner ? { doesAttend: attends, color, cro, specialty } : { role, permissions: perms, doesAttend: attends, color, cro, specialty }
  return (
    <Drawer open onOpenChange={(v) => !v && onClose()} title={member.name}>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-text-muted">{member.email}</p>
        {isOwner && <p className="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent-text">Dono da clínica: tem todas as permissões e não pode ser desativado.</p>}
        {!isOwner && <RolePicker value={role} onChange={(r) => { setRole(r); setPerms(catalog.presets[r]) }} />}
        <Switch label="Atende pacientes (tem agenda)" checked={attends} onCheckedChange={setAttends} />
        {attends && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="CRO"><Input value={cro} onChange={(e) => setCro(e.target.value)} placeholder="Ex.: SC-12345" /></Field>
              <Field label="Especialidade"><Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} /></Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-xs font-semibold">Cor na agenda</legend>
              <div className="flex flex-wrap gap-2">
                {LABEL_SWATCH.map((c) => (
                  <button key={c} type="button" aria-label={COLOR_NAMES[c]} title={COLOR_NAMES[c]} aria-pressed={color === c} onClick={() => setColor(c)}
                    className={cn('size-8 rounded-pill border-2', color === c ? 'border-text' : 'border-transparent')}
                    style={{ background: `var(--c-label-${c}-bar)` }} />
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-semibold">Horário de atendimento</legend>
              <div role="radiogroup" aria-label="Horário de atendimento" className="flex flex-col gap-1.5 text-sm">
                {[false, true].map((v) => (
                  <label key={String(v)} className="flex cursor-pointer items-center gap-2">
                    <input type="radio" name={`own-${member.id}`} checked={ownHours === v} onChange={() => setOwn(v)} className="accent-[var(--c-accent)]" />
                    {v ? 'Horário próprio' : 'Segue o expediente da clínica'}
                  </label>
                ))}
              </div>
              {ownHours && <HoursEditor value={shownHours} onChange={setHours} />}
            </fieldset>
          </>
        )}
        {!isOwner && (
          <section aria-labelledby="perm-h">
            <h3 id="perm-h" className="mb-2 text-sm font-semibold">Permissões</h3>
            <PermissionPicker catalog={catalog} value={perms} onChange={setPerms} disabled={member.isMe} />
            {member.isMe && <p className="mt-2 text-xs text-text-muted">Suas próprias permissões só podem ser mudadas por outra pessoa responsável.</p>}
          </section>
        )}
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button loading={save.isPending} disabled={ownHours && attends && hoursProblem(shownHours)} onClick={() => save.mutate(body)}>Salvar</Button>
          {!isOwner && !member.isMe && (member.isActive
            ? <Button variant="secondary" icon={<UserX className="size-4" />} onClick={() => setConfirmOff(true)}>Desativar acesso</Button>
            : <Button variant="secondary" onClick={() => save.mutate({ isActive: true })}>Reativar acesso</Button>)}
        </div>
      </div>
      {confirmOff && (
        <ConfirmDialog open onOpenChange={setConfirmOff} title={`Desativar o acesso de ${member.name}?`}
          body={<>A pessoa é desconectada na hora e não entra mais nesta clínica. O histórico (consultas, orçamentos, recebimentos) continua com o nome dela. Dá para reativar depois.</>}
          confirmLabel="Desativar acesso" loading={save.isPending} onConfirm={() => save.mutate({ isActive: false })} />
      )}
    </Drawer>
  )
}
