import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleAuth } from 'google-auth-library';

// Vertex AI often takes longer than default 10s. Set max duration to 60s (Limit for Vercel Hobby).
// For Pro plan, you can increase this.
export const config = {
  maxDuration: 60, 
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image, prompt, aspectRatio } = req.body;

    if (!image || !prompt) {
      return res.status(400).json({ error: 'Missing image or prompt' });
    }

    const projectId = process.env.GCP_PROJECT_ID;
    const clientEmail = process.env.GCP_CLIENT_EMAIL;
    const privateKey = process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      console.error("Missing GCP Credentials in Environment Variables");
      return res.status(500).json({ error: 'Server configuration error: Missing GCP Credentials. Please set GCP_PROJECT_ID, GCP_CLIENT_EMAIL, and GCP_PRIVATE_KEY in Vercel.' });
    }

    // 1. Authenticate with Google Cloud
    const auth = new GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
        project_id: projectId,
      },
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // 2. Prepare Vertex AI Request
    // Model: veo-2.0-generate-preview or veo-3.1-fast-generate-preview
    // Using 'veo-3.1-fast-generate-preview' for speed
    const location = 'us-central1'; // Veo is available in us-central1
    const modelId = 'veo-3.1-fast-generate-preview'; 
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;

    // Clean base64 string
    const base64Image = image.includes(',') ? image.split(',')[1] : image;

    // Payload for Vertex AI Veo (Multimodal)
    const payload = {
      instances: [
        {
          prompt: prompt,
          image: {
             bytesBase64Encoded: base64Image
          }
        }
      ],
      parameters: {
        aspectRatio: aspectRatio || "9:16",
        sampleCount: 1,
        // negativePrompt: "", // Optional
      }
    };

    console.log(`Calling Vertex AI Endpoint: ${endpoint}`);

    // 3. Call Vertex AI REST API
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Vertex AI Error Response:", JSON.stringify(data));
      throw new Error(data.error?.message || `Vertex AI API Failed with status ${response.status}`);
    }

    // 4. Extract Video
    // Veo on Vertex returns predictions array
    let videoBase64 = null;

    if (data.predictions && data.predictions.length > 0) {
      // Structure check
      const prediction = data.predictions[0];
      
      // Look for bytesBase64Encoded directly or nested in video object
      if (typeof prediction === 'string') {
          // Sometimes purely base64 string
          videoBase64 = prediction;
      } else if (prediction.bytesBase64Encoded) {
          videoBase64 = prediction.bytesBase64Encoded;
      } else if (prediction.video?.bytesBase64Encoded) {
          videoBase64 = prediction.video.bytesBase64Encoded;
      }
    }

    if (!videoBase64) {
      console.error("Unexpected Vertex AI response format:", JSON.stringify(data));
      return res.status(500).json({ error: 'No video data received from Vertex AI.' });
    }

    // Success
    return res.status(200).json({ video: `data:video/mp4;base64,${videoBase64}` });

  } catch (error: any) {
    console.error("API Handler Error:", error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}