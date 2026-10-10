import { Check, Copy, Download, ExternalLink, Lock, Mail, MessageCircle, Package, Printer, RefreshCw, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Delivery } from '../../../../src/ui/api-types';
import { useDelivery, useGenerateDelivery, useMarkSent, useSaveDelivery, useUnsend } from '../../api';
import { Button, ButtonA, buttonClass } from '../../components/ui/button';
import { Chip } from '../../components/ui/chip';
import { Confirm, Dialog } from '../../components/ui/dialog';
import { Empty } from '../../components/ui/empty';
import { Notice } from '../../components/ui/notice';
import { Section } from '../../components/ui/section';
import { Segmented } from '../../components/ui/segmented';
import { SkeletonRows } from '../../components/ui/skeleton';
import { ErrorState } from '../../components/ui/states';
import { useToast } from '../../components/ui/toast';
import { cn } from '../../lib/cn';
import { CHANNEL_LABEL, clock, money, waNumber } from '../../lib/format';
import { useBusiness } from './context';
import { useAutosave, useCopy } from './deliver-copy';
import { FollowUpPanel, MessageHistory, PreviewOpensLine, SendEmailButton, SendingLine } from './deliver-outreach';

type Tab = 'email' | 'whatsapp' | 'script' | 'package';
const CHANNELS = ['email', 'phone', 'walk_in', 'whatsapp', 'dm'] as const;

export function DeliverTab() {
  const { slug } = useBusiness();
  const delivery = useDelivery(slug);
  const generate = useGenerateDelivery();
  const toast = useToast();

  if (delivery.error) return <ErrorState error={delivery.error} what="the delivery package" />;
  if (delivery.isLoading) return <SkeletonRows rows={4} />;
  if (!delivery.data) {
    return (
      <Section>
        <Empty icon={Package} action={<Button variant="primary" loading={generate.isPending} onClick={() => generate.mutate(slug, { onError: (e) => toast({ kind: 'error', text: `Couldn't generate the package: ${e.message}` }) })}>Generate the package</Button>}>
          There's no pitch package yet. Generate the email, messages and script for this business.
        </Empty>
      </Section>
    );
  }
  return <Composer d={delivery.data} />;
}

function Composer({ d }: { d: Delivery }) {
  const { lead } = useBusiness();
  const [tab, setTab] = useState<Tab>(d.emailAllowed ? 'email' : d.channel === 'whatsapp' ? 'whatsapp' : 'script');
  const blocked = d.senderMissing.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <Notice tone={d.emailAllowed ? 'ok' : 'warn'} title={d.emailAllowed ? 'Cold email allowed' : 'No cold email'}>
        {d.complianceNote}
      </Notice>
      {blocked ? (
        <Notice tone="bad" title="Fill in your sender details before sending">
          These fields in <code className="rounded bg-white/10 px-1 font-mono text-xs">config/offer.yaml</code> still hold placeholders: {d.senderMissing.join(', ')}. Every marketing email must carry your name and postal address.
        </Notice>
      ) : null}
      <SendingLine />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Section title={<Segmented label="Message" value={tab} onChange={setTab} options={[
          { value: 'email', label: 'Email' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'script', label: 'Script' }, { value: 'package', label: 'Package' },
        ]} />} actions={<RegenerateButton slug={d.slug} />} bodyClassName="p-5">
          {tab === 'email' ? <EmailPane d={d} blocked={blocked} /> : null}
          {tab === 'whatsapp' ? <WhatsAppPane d={d} /> : null}
          {tab === 'script' ? <ScriptPane d={d} /> : null}
          {tab === 'package' ? <PackagePane d={d} name={lead.name} /> : null}
        </Section>
        <div className="flex flex-col gap-4">
          <SendPanel d={d} blocked={blocked} />
        </div>
      </div>
      <FollowUpPanel slug={d.slug} />
      <MessageHistory slug={d.slug} />
    </div>
  );
}

function SaveNote({ state }: { state: ReturnType<typeof useAutosave> }) {
  const text = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? "Couldn't save" : '';
  return <span aria-live="polite" className={cn('text-xs', state === 'error' ? 'text-bad' : 'text-fg-3')}>{text}</span>;
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const { copy, copied } = useCopy();
  return <Button size="sm" variant="secondary" onClick={() => void copy(text)}>{copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}{copied ? 'Copied' : label}</Button>;
}

function EmailPane({ d, blocked }: { d: Delivery; blocked: boolean }) {
  const save = useSaveDelivery();
  const [subject, setSubject] = useState(d.subject);
  const [body, setBody] = useState(d.body);
  useEffect(() => { setSubject(d.subject); setBody(d.body); }, [d.createdAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const s1 = useAutosave(subject, d.subject, (v) => save.mutateAsync({ slug: d.slug, patch: { subject: v } }));
  const s2 = useAutosave(body, d.body, (v) => save.mutateAsync({ slug: d.slug, patch: { body: v } }));
  const state = s1 === 'saving' || s2 === 'saving' ? 'saving' : s1 === 'error' || s2 === 'error' ? 'error' : s1 === 'saved' || s2 === 'saved' ? 'saved' : 'idle';

  if (!d.emailAllowed) {
    return (
      <Empty icon={Lock}>
        Email is off for this business. {d.complianceNote}
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <label className="label" htmlFor="d-to">To</label>
        {d.to ? <input id="d-to" className="field" value={d.to} readOnly /> : <p id="d-to" className="text-sm text-fg-3">No email address yet. Add one on the Overview tab if you find it.</p>}
      </div>
      <div className="grid gap-1.5">
        <label className="label" htmlFor="d-subject">Subject</label>
        <input id="d-subject" className="field" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <label className="label" htmlFor="d-body">Body</label>
        <textarea id="d-body" className="field min-h-72 font-[inherit]" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {blocked ? (
          <Button variant="primary" disabled title="Fill in your sender details first"><Mail className="size-4" aria-hidden />Open in Mail</Button>
        ) : (
          <a href={d.emlUrl} download={`${d.slug}.eml`} className={buttonClass('primary')}><Mail className="size-4" aria-hidden />Open in Mail</a>
        )}
        {d.to ? <CopyButton text={d.to} label="Copy address" /> : null}
        <CopyButton text={subject} label="Copy subject" />
        <CopyButton text={body} label="Copy body" />
        <span className="ml-auto"><SaveNote state={state} /></span>
      </div>
      <p className="text-xs text-fg-3">Copy each part into a new email, or Open in Mail for a draft with the before-and-after image attached. Edits save automatically.</p>
    </div>
  );
}

function WhatsAppPane({ d }: { d: Delivery }) {
  const save = useSaveDelivery();
  const [text, setText] = useState(d.whatsapp);
  useEffect(() => { setText(d.whatsapp); }, [d.createdAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = useAutosave(text, d.whatsapp, (v) => save.mutateAsync({ slug: d.slug, patch: { whatsapp: v } }));
  const wa = waNumber(d.phoneE164 ?? d.phone);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <label className="label" htmlFor="d-wa">Message</label>
        <textarea id="d-wa" className="field min-h-48 font-[inherit]" value={text} onChange={(e) => setText(e.target.value)} />
        <span className="text-xs text-fg-3">{text.length} characters</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {wa ? <ButtonA variant="primary" href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`}><MessageCircle className="size-4" aria-hidden />Open WhatsApp</ButtonA>
          : <Button variant="primary" disabled title="No mobile number for this business"><MessageCircle className="size-4" aria-hidden />Open WhatsApp</Button>}
        <CopyButton text={text} />
        <span className="ml-auto"><SaveNote state={state} /></span>
      </div>
      {!wa ? <p className="text-xs text-fg-3">There's no UK mobile number for this business, so WhatsApp can't open a chat. Copy the message instead.</p> : null}
    </div>
  );
}

function ScriptPane({ d }: { d: Delivery }) {
  const print = () => {
    const w = window.open('', '_blank', 'noopener,width=720,height=900');
    if (!w) return;
    const pre = w.document.createElement('pre');
    pre.style.cssText = 'font: 15px/1.6 system-ui, sans-serif; white-space: pre-wrap; padding: 32px; max-width: 640px';
    pre.textContent = d.script;
    w.document.body.appendChild(pre);
    w.print();
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2"><Chip>{CHANNEL_LABEL[d.channel] ?? d.channel} script</Chip>{d.phone ? <a href={`tel:${d.phoneE164 ?? d.phone}`} className="text-sm text-fg underline underline-offset-2">{d.phone}</a> : null}</div>
      <div className="glass rounded-card p-4 text-sm leading-6 whitespace-pre-wrap text-fg">{d.script}</div>
      <div className="flex flex-wrap gap-2"><CopyButton text={d.script} /><Button size="sm" variant="outline" onClick={print}><Printer className="size-3.5" aria-hidden />Print</Button></div>
    </div>
  );
}

function PackagePane({ d, name }: { d: Delivery; name: string }) {
  let host = d.previewUrl;
  try { host = d.previewUrl ? new URL(d.previewUrl).host : null; } catch { /* keep */ }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {d.previewUrl ? <ButtonA variant="secondary" size="sm" href={d.previewUrl}><ExternalLink className="size-3.5" aria-hidden />Open preview</ButtonA> : <Chip hollow>Not deployed yet</Chip>}
        <a href={d.zipUrl} download className={buttonClass('secondary', 'sm')}><Download className="size-3.5" aria-hidden />Download package</a>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="label mb-2">Link preview</p>
          <div className="glass overflow-hidden rounded-card">
            {d.ogUrl ? <img src={d.ogUrl} alt="" className="aspect-[1.91/1] w-full bg-white/5 object-cover" loading="lazy" /> : <div className="checker aspect-[1.91/1] w-full" />}
            <div className="px-3.5 py-2.5">
              <p className="truncate text-sm font-medium text-fg">{name}</p>
              <p className="truncate text-xs text-fg-3">{host ?? 'No preview link yet'}</p>
            </div>
          </div>
          <p className="mt-1.5 text-xs text-fg-3">Roughly how the link looks in Messages and WhatsApp.</p>
        </div>
        <div>
          <p className="label mb-2">Before and after</p>
          {d.compareUrl ? <a href={d.compareUrl} target="_blank" rel="noreferrer"><img src={d.compareUrl} alt="Their current site beside the new preview" className="w-full rounded-card border border-border-soft" loading="lazy" /></a>
            : <p className="text-sm text-fg-3">No comparison image yet.</p>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="label">Price</p>
          <p className="mt-1.5"><span className="num-display text-[30px]">{money(d.price.build)}</span><span className="ml-2 text-sm text-fg-3">then {money(d.price.monthly)}/month</span></p>
          {d.upsells.length ? (<><p className="label mt-4">Upsells</p><ul className="mt-1.5 flex flex-col gap-1 text-sm text-fg-2">{d.upsells.map((u) => <li key={u}>{u}</li>)}</ul></>) : null}
        </div>
        <div>
          <p className="label">Questions for the owner</p>
          {d.ownerQuestions.length ? <ul className="mt-1.5 list-disc pl-5 text-sm text-fg-2">{d.ownerQuestions.map((q) => <li key={q}>{q}</li>)}</ul> : <p className="mt-1.5 text-sm text-fg-3">None recorded.</p>}
        </div>
      </div>
    </div>
  );
}

function RegenerateButton({ slug }: { slug: string }) {
  const generate = useGenerateDelivery();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><RefreshCw className="size-3.5" aria-hidden />Regenerate</Button>
      <Confirm open={open} onClose={() => setOpen(false)} title="Regenerate the package?" confirmLabel="Regenerate" busy={generate.isPending}
        onConfirm={() => generate.mutate(slug, {
          onSuccess: () => { setOpen(false); toast({ kind: 'ok', text: 'Package regenerated' }); },
          onError: (e) => { setOpen(false); toast({ kind: 'error', text: `Couldn't regenerate: ${e.message}` }); },
        })}>
        This rewrites the email and messages, replacing your edits.
      </Confirm>
    </>
  );
}

function SendPanel({ d, blocked }: { d: Delivery; blocked: boolean }) {
  const markSent = useMarkSent();
  const unsend = useUnsend();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<string>(CHANNELS.includes(d.channel as (typeof CHANNELS)[number]) ? d.channel : 'phone');
  const undo = () => unsend.mutate(d.slug, {
    onSuccess: () => toast({ kind: 'info', text: 'Marked as not sent' }),
    onError: (e) => toast({ kind: 'error', text: `Couldn't undo: ${e.message}` }),
  });
  const confirm = () => markSent.mutate({ slug: d.slug, channel }, {
    onSuccess: () => { setOpen(false); toast({ kind: 'ok', text: `Marked as sent by ${CHANNEL_LABEL[channel] ?? channel}`, action: { label: 'Undo', onClick: undo } }); },
    onError: (e) => toast({ kind: 'error', text: `Couldn't mark as sent: ${e.message}` }),
  });

  return (
    <section className={cn(d.sentAt ? 'glass' : 'glass-lit', 'flex flex-col gap-4 self-start rounded-panel p-5')} aria-label="Send">
      {d.sentAt ? (
        <>
          <p className="flex items-center gap-2 text-sm text-fg-2"><Check className="size-4 text-ok" aria-hidden />Sent</p>
          <p className="num-display text-[26px]">{clock(d.sentAt)}</p>
          <p className="text-sm text-fg-3">By {CHANNEL_LABEL[d.sentChannel ?? ''] ?? d.sentChannel ?? 'an unknown channel'}.</p>
          <PreviewOpensLine slug={d.slug} />
          <Button variant="outline" loading={unsend.isPending} onClick={undo}>Undo</Button>
        </>
      ) : (
        <>
          <p className="text-sm text-fg-2">Ready to send</p>
          <p className="num-display text-[26px]">{CHANNEL_LABEL[d.channel] ?? d.channel}</p>
          <p className="text-sm text-fg-3">Suggested channel. Send the message, then mark it here so the follow-up reminders start.</p>
          <SendEmailButton d={d} onSent={() => undefined} />
          <Button variant={d.emailAllowed ? 'secondary' : 'primary'} size="lg" disabled={blocked} title={blocked ? 'Fill in your sender details first' : undefined} onClick={() => setOpen(true)}><Send className="size-4" aria-hidden />Mark as sent</Button>
        </>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Mark as sent" actions={<>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="primary" loading={markSent.isPending} onClick={confirm}>Mark as sent</Button>
      </>}>
        <fieldset>
          <legend className="mb-2">How did you send it?</legend>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((c) => {
              const disabled = c === 'email' && !d.emailAllowed;
              return (
                <label key={c} className={cn('inline-flex h-(--row-h) cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm', channel === c ? 'border-border bg-white/12 text-fg' : 'border-border-soft text-fg-2', disabled && 'cursor-not-allowed opacity-40')}>
                  <input type="radio" name="channel" value={c} checked={channel === c} disabled={disabled} onChange={() => setChannel(c)} className="sr-only" />
                  {CHANNEL_LABEL[c] ?? c}
                </label>
              );
            })}
          </div>
        </fieldset>
      </Dialog>
    </section>
  );
}
