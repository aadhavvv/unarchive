// Vercel serverless function — POST { items: [{ id, name, brand, category, condition }] }
// Returns: { outfits: [{ title, item_ids: [id, id, ...], why }] }
// Requires env var ANTHROPIC_API_KEY set in Vercel project settings.
// Text-only request — small payload, no image size concerns.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY' })
  }

  const { items } = req.body || {}
  if (!Array.isArray(items) || items.length < 1) {
    return res.status(400).json({ error: 'Add at least 1 wardrobe item first' })
  }

  // Only send the fields the model actually needs — keeps payload tiny.
  const trimmed = items.slice(0, 60).map(i => ({
    id: i.id,
    name: i.name,
    brand: i.brand,
    category: i.category,
    condition: i.condition,
  }))

  const prompt = `Here is a list of clothing items from someone's real wardrobe, as JSON:
${JSON.stringify(trimmed)}

Suggest up to 3 outfit or styling ideas using ONLY items from this exact list — never invent items that aren't listed.

If there are enough complementary items (e.g. a top and a bottom, or a dress), build full outfits of 2-4 items each.
If the wardrobe is small or items don't naturally combine (e.g. only 2 tops, nothing else), it's fine to suggest a single item with a styling tip instead of forcing a full outfit — just make sure every outfit references at least 1 real item from the list.

Respond with ONLY a JSON object, no other text, no markdown fences, in this exact shape:
{"outfits": [{"title": "short outfit name", "item_ids": ["id1", "id2"], "why": "one short sentence on why these work together or how to style this piece"}]}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...(workspaceId ? { 'anthropic-workspace-id': workspaceId } : {}),
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      console.error('Anthropic API error', response.status, detail)
      return res.status(502).json({ error: 'Vision API error', detail })
    }

    const data = await response.json()
    const textBlock = (data.content || []).find(b => b.type === 'text')
    if (!textBlock) {
      return res.status(502).json({ error: 'No text in response' })
    }

    const cleaned = textBlock.text.replace(/```json|```/g, '').trim()
    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch (e) {
      console.error('Could not parse stylist response', cleaned)
      return res.status(502).json({ error: 'Could not parse response', raw: cleaned })
    }

    if (!Array.isArray(parsed.outfits)) {
      return res.status(502).json({ error: 'Unexpected response shape' })
    }

    // Validate: only keep outfits whose item_ids actually exist in what we sent
    const validIds = new Set(trimmed.map(i => String(i.id)))
    const outfits = parsed.outfits
      .map(o => ({
        title: String(o.title || 'Outfit').slice(0, 60),
        why: String(o.why || '').slice(0, 150),
        item_ids: Array.isArray(o.item_ids) ? o.item_ids.filter(id => validIds.has(String(id))) : [],
      }))
      .filter(o => o.item_ids.length >= 1)

    return res.status(200).json({ outfits })
  } catch (err) {
    console.error('Stylist function error', err)
    return res.status(500).json({ error: 'Server error', detail: String(err) })
  }
}
