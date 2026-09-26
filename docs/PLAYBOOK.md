# Playbook: manual build and outreach

The human half of the MVP. Used until Phase 1 and Phase 2 replace the build and drafting steps.

---

## Manual build checklist

Time-box to two hours. Stop at two hours even if it isn't perfect. A rough preview that goes out beats a polished one that doesn't.

Stack for hand builds: Next.js App Router, Tailwind, deployed to a `preview` project on Vercel Pro at `preview.yourdomain.co.uk/<slug>` or `<slug>.preview.yourdomain.co.uk`. Add `noindex` to every preview.

**Above the fold on mobile**

- [ ] Business name, one-line what-and-where ("Gas Safe plumber in Erdington and north Birmingham")
- [ ] Call button and WhatsApp button, both tappable without scrolling
- [ ] Star rating and review count pulled from their Google listing

**Body**

- [ ] Three to six services, one short paragraph each, each also gets its own page
- [ ] Areas served, one line each linking to an area page for the top three
- [ ] Two or three review quotes from Google with first name and date
- [ ] Opening hours matching the Google listing exactly
- [ ] Address matching the Google listing exactly, embedded map
- [ ] Simple contact form that emails you for now, swapped to them on handover

**Technical**

- [ ] Title and meta description per page, mention service and area
- [ ] LocalBusiness JSON-LD with name, phone, address, hours, geo
- [ ] Open Graph image
- [ ] Sitemap and robots (robots disallows all while it's a preview)
- [ ] Lighthouse mobile performance 90 or above. Stock images through `next/image`, no web fonts beyond one
- [ ] Stock images only, licensed. Text logo. No content copied from their existing site beyond facts

**Log what repeats** in `docs/build-notes.md`: components you rebuilt, copy patterns, per-vertical differences. This is the Phase 1 spec.

---

## Choosing the channel

| Entity type | Allowed | Preferred |
|---|---|---|
| Limited company or LLP | Email, phone, DM, walk-in | Email with the preview link, phone if no reply |
| Sole trader, partnership, unknown | Phone, DM, walk-in. Email only if they ask you to send it | Phone for trades, walk-in for cafes and barbers, Instagram DM for beauty |

If in doubt, treat as sole trader. A phone call where they say "text me the link" is consent to send one message with the link.

---

## Email template (limited companies only)

Under 120 words. Plain text. One link. Sent from your sending domain, not your main one.

```
Subject: Made you a quick website mock-up, [Business]

Hi [first name or team],

I'm [Your name], a web developer in [your area], Birmingham. I noticed
[Business] [doesn't have a website / has a site that doesn't work well on
phones], so I put together a version of what one could look like:

[preview link]  (best on your phone)

It's built to load fast, show up on Google for "[service] [area]", and
let people call or WhatsApp you in one tap.

If you'd like it, it's £[X] to finish with your own photos and words,
then £[Y] a month for hosting and any changes. I can sort a .co.uk
domain and a proper email address too.

No pressure either way. Happy to tweak it or answer anything.

[Your name]
[phone] · [your site]

[Your trading name], [postal address]. Reply "no thanks" and I won't
contact you again.
```

**Follow-up 1, day three.** Two lines. "Just checking this reached you. Here's the link again. Happy to change anything."

**Follow-up 2, day eight.** Two lines. "Last note from me. If it's not the right time, no problem, I'll leave it there." Then stop.

---

## Phone script (trades and services)

Call between 9 and 11 or 2 and 4. Not Mondays.

```
Hi, is that [name]? I'm [Your name], I'm a web developer in [area].
I build sites for local [trade]s. I noticed you [haven't got one / yours
doesn't load properly on a phone], and I've actually mocked one up for
you already. Can I text you the link so you can have a look when you've
got a minute?
```

If yes: text the link and the price in one message, that's it. If they ask the price on the phone, say it plainly and say the monthly too. If no: "No problem, thanks for your time." Mark `lost`, add to suppression.

---

## Walk-in (cafes, barbers, salons, takeaways)

Go at a quiet time, mid-afternoon. Have the preview open on your phone.

```
Hi, are you the owner? I'm [Your name], I build websites, I'm just up
the road in [area]. I made a quick one for you, can I show you? Takes
ten seconds.
```

Show it on your phone. Say the price. Leave a card with the link and your number. Don't stay more than two minutes unless they ask questions.

---

## Instagram or Facebook DM (beauty, barbers, food)

```
Hi! Local web dev here in [area]. Love the [photos / reviews], noticed
you don't have a site so I mocked one up: [link]. Built for phones, one
tap to book/call. £[X] if you want it finished with your own photos.
No worries if not!
```

One message. One follow-up after four days. Then stop.

---

## Handling replies

| They say | You do |
|---|---|
| "How much?" | Price and monthly, one sentence, ask if they'd like it |
| "Can you change X?" | Yes, change it same day, send the new link. This is the buying signal |
| "I'll think about it" | "Of course. I'll leave the preview up for two weeks." Follow up once at day ten |
| "We've got someone doing it" | "No problem, good luck with it." Mark `lost` |
| "No" or "stop" | Suppress immediately, no reply needed beyond "Understood, sorry to bother you" |
| Yes | Stripe payment link, ask for photos and any copy, agree a domain, aim to go live within a week |

---

## Status tracking

Use the CLI status command after every touch so the shortlist never resurfaces someone you've already contacted.

```
pnpm pipeline status <slug> contacted
pnpm pipeline status <slug> replied
pnpm pipeline status <slug> won
pnpm pipeline status <slug> do_not_contact
```
