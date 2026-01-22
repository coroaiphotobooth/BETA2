
import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI, { toFile } from 'openai';

export const config = {
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("Missing OPENAI_API_KEY");
      return res.status(500).json({ error: "Server config error: OPENAI_API_KEY missing" });
    }

    const { prompt, imageBase64, size } = req.body;
    
    if (!prompt || !imageBase64) {
      return res.status(400).json({ error: "Missing prompt or image" });
    }

    const openai = new OpenAI({ apiKey });

    // Prepare buffers
    // Image comes as "data:image/png;base64,..." or just base64
    const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    // If mask is provided:
    let maskBuffer;
    if (req.body.maskBase64) {
       const maskData = req.body.maskBase64.includes(',') ? req.body.maskBase64.split(',')[1] : req.body.maskBase64;
       maskBuffer = Buffer.from(maskData, 'base64');
    }

    // Determine size string. Default to 1024x1024 if not provided.
    // DALL-E 2 Edit supports 256x256, 512x512, 1024x1024.
    // If user sends 720, we will try to send "720x720" if the custom model supports it, 
    // or fallback to logic. Since "gpt-image-1.5" is implied as a custom model/wrapper, we pass dynamic.
    // However, for strict type safety or standard endpoints, valid strings are required.
    // We cast to any to allow dynamic strings for custom models.
    const sizeStr = size ? `${size}x${size}` : "1024x1024";

    console.log(`Calling OpenAI Image Edit with model: gpt-image-1.5 | Size: ${sizeStr}`);

    const response = await openai.images.edit({
      model: 'gpt-image-1.5', 
      image: await toFile(imageBuffer, 'image.png'),
      mask: maskBuffer ? await toFile(maskBuffer, 'mask.png') : undefined,
      prompt: prompt,
      n: 1,
      size: sizeStr as any, // Cast to any to support 720x720 if model allows, or standard 512/1024
      response_format: "b64_json",
    });

    const outputBase64 = response.data?.[0]?.b64_json;
    if (!outputBase64) throw new Error("No image returned");

    return res.status(200).json({ imageBase64: `data:image/png;base64,${outputBase64}` });

  } catch (error: any) {
    console.error("OpenAI API Error:", error);
    return res.status(500).json({ error: error.message || "OpenAI Generation Failed" });
  }
}