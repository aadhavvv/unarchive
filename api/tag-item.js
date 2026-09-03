// Vercel serverless function — POST { image: base64string, mimeType: string }
// Returns: { name, brand, category, condition, estimated_resale_value }
// Requires env var ANTHROPIC_API_KEY set in Vercel project settings.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { image, mimeType } = req.body || {}
  if (!image) {
    return res.status(400).json({ error: 'Missing image' })
  }

  const CATS = ["Tops", "Bottoms", "Dresses", "Shoes", "Accessories"]
  const CONDITIONS = ["Like new", "Excellent", "Good", "Fair"]

  const prompt = `You are tagging a garment photo for a wardrobe app. Look at the image and respond with ONLY a JSON object, no other text, no markdown fences. Fields:
- "name": short descriptive item name (e.g. "Oversized wool coat")
- "brand": brand name if a logo/tag is visible and legible, otherwise empty string ""
- "category": one of exactly ${JSON.stringify(CATS)}
- "condition": your best visual guess, one of exactly ${JSON.stringify(CONDITIONS)}
- "estimated_resale_value": a realistic resale price in EUR (integer, no currency symbol) based on the apparent brand/category/condition. If you cannot tell brand, give a conservative generic estimate for that category/condition.

Respond with ONLY the JSON object.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: image },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return res.status(502).json({ error: 'Vision API error', detail: errText })
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
      return res.status(502).json({ error: 'Could not parse tagging response', raw: cleaned })
    }

    // Basic guardrails against bad model output
    if (!CATS.includes(parsed.category)) parsed.category = 'Tops'
    if (!CONDITIONS.includes(parsed.condition)) parsed.condition = 'Good'
    parsed.name = (parsed.name || '').slice(0, 80)
    parsed.brand = (parsed.brand || '').slice(0, 40)
    parsed.estimated_resale_value = Math.max(0, parseInt(parsed.estimated_resale_value) || 0)

    return res.status(200).json(parsed)
  } catch (err) {
    return res.status(500).json({ error: 'Server error', detail: String(err) })
  }
}
