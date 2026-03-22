import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    revendeur_id,
    nom,
    email,
    telephone,
    ville,
    pays,
    message,
    delai,
    recap,
    png,
    pngB,
  } = body

  if (!revendeur_id || !email) {
    return NextResponse.json({ error: 'Champs manquants' }, { status: 400, headers: CORS })
  }

  // Upload PNG si présent
  const ts = Date.now()
  let png_url: string | null = null
  if (png) {
    const buffer = Buffer.from(png, 'base64')
    const filename = `${revendeur_id}/${ts}-mur-a.png`
    const { error: uploadError } = await supabase.storage
      .from('leads-png')
      .upload(filename, buffer, { contentType: 'image/png', upsert: false })
    if (!uploadError) {
      const { data: urlData } = supabase.storage
        .from('leads-png')
        .getPublicUrl(filename)
      png_url = urlData.publicUrl
    }
  }

  let png_url_b: string | null = null
  if (pngB) {
    const bufferB = Buffer.from(pngB, 'base64')
    const filenameB = `${revendeur_id}/${ts}-mur-b.png`
    const { error: uploadErrorB } = await supabase.storage
      .from('leads-png')
      .upload(filenameB, bufferB, { contentType: 'image/png', upsert: false })
    if (!uploadErrorB) {
      const { data: urlDataB } = supabase.storage
        .from('leads-png')
        .getPublicUrl(filenameB)
      png_url_b = urlDataB.publicUrl
    }
  }

  // Enregistrement lead
  const { error } = await supabase
    .from('leads')
    .insert({
      revendeur_id,
      nom,
      email,
      telephone,
      ville,
      pays,
      message,
      delai,
      recap,
      png_url,
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS })
  }

  // Récupérer profil + config du revendeur en parallèle
  const [{ data: profile }, { data: config }] = await Promise.all([
    supabase.from('profiles').select('email').eq('id', revendeur_id).single(),
    supabase.from('configurations').select('nom_commercial').eq('revendeur_id', revendeur_id).single(),
  ])

  const nomCommercial = config?.nom_commercial || 'Kuchee'
  // Expéditeur fixe sur domaine vérifié Resend — revendeur en reply_to pour réponses directes
  const from = `${nomCommercial} <no-reply@kuchee.com>`
  const reply_to = profile?.email || undefined

  const delaiLabel =
    delai === 'immediat' ? '⚡ Immédiat' :
    delai === '3-6mois'  ? '📅 3 à 6 mois' :
    delai === '6plus'    ? '🕐 Plus de 6 mois' : ''

  const rowTel     = telephone ? `<tr><td style="padding:8px 0;color:#999;width:140px">Téléphone</td><td style="padding:8px 0;color:#222">${telephone}</td></tr>` : ''
  const rowVille   = ville     ? `<tr><td style="padding:8px 0;color:#999">Ville</td><td style="padding:8px 0;color:#222">${ville}</td></tr>` : ''
  const rowPays    = pays      ? `<tr><td style="padding:8px 0;color:#999">Pays</td><td style="padding:8px 0;color:#222">${pays}</td></tr>` : ''
  const rowDelai   = delai     ? `<tr><td style="padding:8px 0;color:#999">Délai projet</td><td style="padding:8px 0;color:#222;font-weight:bold">${delaiLabel}</td></tr>` : ''
  const rowMessage = message   ? `<tr><td style="padding:8px 0;color:#999">Message</td><td style="padding:8px 0;color:#222">${message}</td></tr>` : ''

  const blockPng = png_url ? `
    <div style="font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;margin-bottom:12px">${png_url_b ? 'Plan de configuration — Mur A' : 'Plan de configuration'}</div>
    <img src="${png_url}" alt="Plan cuisine Mur A" style="width:100%;border:1px solid #eee;border-radius:4px;margin-bottom:${png_url_b ? '12px' : '24px'}"/>
  ` : ''

  const blockPngB = png_url_b ? `
    <div style="font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;margin-bottom:12px">Plan de configuration — Mur B</div>
    <img src="${png_url_b}" alt="Plan cuisine Mur B" style="width:100%;border:1px solid #eee;border-radius:4px;margin-bottom:24px"/>
  ` : ''

  const blockRecap = recap ? `
    <div style="font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;margin-bottom:12px">Récapitulatif de votre projet</div>
    <pre style="font-size:10px;background:#f9f9f9;border:1px solid #eee;padding:12px;border-radius:4px;white-space:pre-wrap;color:#555">${recap}</pre>
  ` : ''

  // Email notification revendeur
  const htmlRevendeur = `
    <div style="font-family:'Courier New',monospace;max-width:600px;margin:0 auto;padding:32px;background:#fff;border:1px solid #e8e8e8">
      <div style="font-size:18px;font-weight:bold;letter-spacing:2px;margin-bottom:24px;border-bottom:2px solid #222;padding-bottom:12px">
        ${nomCommercial} — Nouveau lead
      </div>
      <div style="font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;margin-bottom:16px">Coordonnées du prospect</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:24px">
        <tr><td style="padding:8px 0;color:#999;width:140px">Nom</td><td style="padding:8px 0;color:#222;font-weight:bold">${nom || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#999">Email</td><td style="padding:8px 0;color:#222">${email}</td></tr>
        ${rowTel}${rowVille}${rowPays}${rowDelai}${rowMessage}
      </table>
      ${blockPng}
      ${blockPngB}
      ${blockRecap}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e8e8e8;font-size:11px;color:#bbb">
        <a href="https://app.kuchee.com/dashboard" style="color:#222;font-weight:bold">Consultez tous vos leads sur votre dashboard →</a>
      </div>
    </div>
  `

  // Email confirmation client
  const htmlClient = `
    <div style="font-family:'Courier New',monospace;max-width:600px;margin:0 auto;padding:32px;background:#fff;border:1px solid #e8e8e8">
      <div style="font-size:18px;font-weight:bold;letter-spacing:2px;margin-bottom:24px;border-bottom:2px solid #222;padding-bottom:12px">
        ${nomCommercial} — Votre projet cuisine
      </div>
      <div style="font-size:13px;color:#444;line-height:1.8;margin-bottom:24px">
        Bonjour ${nom || ''},<br/><br/>
        Nous avons bien reçu votre demande de devis et reviendrons vers vous dans les meilleurs délais.
      </div>
      <div style="font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;margin-bottom:16px">Récapitulatif de votre demande</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:24px">
        <tr><td style="padding:8px 0;color:#999;width:140px">Nom</td><td style="padding:8px 0;color:#222;font-weight:bold">${nom || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#999">Email</td><td style="padding:8px 0;color:#222">${email}</td></tr>
        ${rowTel}${rowVille}${rowPays}${rowDelai}${rowMessage}
      </table>
      ${blockPng}
      ${blockPngB}
      ${blockRecap}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e8e8e8;font-size:11px;color:#bbb">
        Cet email a été envoyé automatiquement — merci de ne pas y répondre directement.
      </div>
    </div>
  `

  // Envoi des deux emails en parallèle avec log des erreurs
  const [resRevendeur, resClient] = await Promise.all([
    profile?.email
      ? resend.emails.send({ from, reply_to, to: profile.email, subject: `🔔 Nouveau lead — ${nom} · ${ville || 'Localisation non renseignée'}`, html: htmlRevendeur })
      : Promise.resolve({ error: null }),
    resend.emails.send({ from, reply_to, to: email, subject: `Votre projet cuisine — Confirmation de réception`, html: htmlClient }),
  ])

  if (resRevendeur && 'error' in resRevendeur && resRevendeur.error) {
    console.error('[leads] email revendeur error:', resRevendeur.error)
  }
  if (resClient && 'error' in resClient && resClient.error) {
    console.error('[leads] email client error:', resClient.error)
  }

  return NextResponse.json({ ok: true }, { headers: CORS })
}
