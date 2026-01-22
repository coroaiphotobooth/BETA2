
import { GoogleGenAI } from "@google/genai";
import { PhotoboothSettings, AspectRatio } from "../types";

// Helper to Resize Image Client-Side
const resizeImageForOpenAI = async (base64Str: string, maxDim: number = 1024): Promise<{ image: string, mask: string }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      
      // Calculate aspect ratio
      const ratio = w / h;
      
      // Resize logic: maintain aspect ratio, fit within maxDim x maxDim
      // Also ensure it is a valid size? OpenAI strictly wants 256, 512, 1024 SQUARE for DALL-E 2.
      // But user requested 720px default.
      // And 'gpt-image-1.5' might be flexible.
      // We will resize so longest edge is 'maxDim'.
      if (w > h) {
        if (w > maxDim) { w = maxDim; h = Math.round(maxDim / ratio); }
      } else {
        if (h > maxDim) { h = maxDim; w = Math.round(maxDim * ratio); }
      }

      // Force Square Canvas for OpenAI DALL-E 2 compatibility (center image)
      // If we don't do this, standard 'edit' endpoint might reject it.
      // We'll use a square canvas of maxDim size.
      canvas.width = maxDim;
      canvas.height = maxDim;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject("No Canvas Context");
      
      // Clear (Transparent)
      ctx.clearRect(0, 0, maxDim, maxDim);
      
      // Draw Image Centered
      const x = (maxDim - w) / 2;
      const y = (maxDim - h) / 2;
      ctx.drawImage(img, x, y, w, h);
      
      const resizedImage = canvas.toDataURL('image/png'); // RGBA

      // Generate Transparent Mask (Fully transparent = edit everything?)
      // In DALL-E edit: Transparent pixels in the MASK indicate where to edit.
      // We want to edit the whole image area.
      // So we create a fully transparent mask.
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = maxDim;
      maskCanvas.height = maxDim;
      const maskCtx = maskCanvas.getContext('2d');
      if (!maskCtx) return reject("No Mask Context");
      
      // Clear to transparent (Alpha 0)
      maskCtx.clearRect(0, 0, maxDim, maxDim);
      
      // NOTE: For DALL-E 2, "Transparent areas of the mask indicate where the image should be edited."
      // So a fully transparent mask means "Edit Everything".
      // Just to be safe, let's make sure it's fully transparent.
      // (clearRect does that).
      
      const maskImage = maskCanvas.toDataURL('image/png');
      
      resolve({ image: resizedImage, mask: maskImage });
    };
    img.onerror = reject;
    img.src = base64Str;
  });
};

const detectPeopleCount = async (ai: GoogleGenAI, base64: string, mimeType: string): Promise<number> => {
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { data: base64, mimeType } },
          { text: "How many humans are visible in this image? Return strictly just the integer number. If unsure or 0, return 1." }
        ]
      }
    });
    
    // Parse result
    const text = result.text;
    if (text) {
        const num = parseInt(text.trim());
        return isNaN(num) ? 1 : num;
    }
    return 1;
  } catch (e) {
    console.warn("Detection failed, defaulting to 1 person", e);
    return 1;
  }
};

export const generateAIImage = async (base64Source: string, prompt: string, outputRatio: AspectRatio = '9:16') => {
  try {
    const storedSettings = localStorage.getItem('pb_settings');
    let selectedModel = 'gemini-2.5-flash-image';
    let gptSize = 1024;
    
    if (storedSettings) {
      const parsedSettings: PhotoboothSettings = JSON.parse(storedSettings);
      if (parsedSettings.selectedModel) {
        selectedModel = parsedSettings.selectedModel;
      }
      if (parsedSettings.gptModelSize) {
         gptSize = parseInt(parsedSettings.gptModelSize);
      }
    }

    // --- OPENAI FLOW ---
    if (selectedModel === 'gpt-image-1.5') {
       console.log(`Using OpenAI Provider (GPT-Image-1.5) | Size: ${gptSize}px`);
       try {
         // Resize and Generate Mask (Square 1024 or custom size for compatibility)
         const { image: resizedBase64, mask: maskBase64 } = await resizeImageForOpenAI(base64Source, gptSize);
         
         const response = await fetch('/api/generate-image-openai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
               prompt: prompt + " photorealistic, highly detailed, preserve identity",
               imageBase64: resizedBase64,
               maskBase64: maskBase64,
               size: gptSize // Pass size to server
            })
         });
         
         if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || "OpenAI Generation Failed");
         }
         
         const data = await response.json();
         return data.imageBase64;
         
       } catch (err: any) {
         console.warn("OpenAI Failed. Falling back to Gemini 2.5.", err);
         // FALLBACK to Gemini
         selectedModel = 'gemini-2.5-flash-image';
         // Proceed to Gemini logic below...
       }
    }

    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API Key missing. Please create a .env file with API_KEY=AIzaSy...");

    const ai = new GoogleGenAI({ apiKey });
    const mimeType = base64Source.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    const cleanBase64 = base64Source.split(',')[1];

    // --- SMART DETECTION LOGIC ---
    if (selectedModel === 'auto') {
       console.log("Auto Mode: Detecting people count...");
       const personCount = await detectPeopleCount(ai, cleanBase64, mimeType);
       console.log(`Detected ${personCount} people.`);
       
       if (personCount > 1) {
          selectedModel = 'gemini-3-pro-image-preview';
          console.log("Switching to Model 3 Pro (Group Mode)");
       } else {
          selectedModel = 'gemini-2.5-flash-image';
          console.log("Switching to Model 2.5 Flash (Single Mode)");
       }
    }
    // -----------------------------

    let apiAspectRatio = '9:16';
    if (outputRatio === '16:9') apiAspectRatio = '16:9';
    if (outputRatio === '9:16') apiAspectRatio = '9:16';
    if (outputRatio === '3:2') apiAspectRatio = '4:3';
    if (outputRatio === '2:3') apiAspectRatio = '3:4';

    const executeGenAI = async (model: string, useProConfig: boolean) => {
      const imageConfig: any = { aspectRatio: apiAspectRatio };
      if (useProConfig) imageConfig.imageSize = '1K';

      const finalPrompt = `*** EDIT MODE: HARD LOCK ENABLED ***
STRICT CONSTRAINTS:
1. PRESERVE IDENTITY: Face, features, and skin tone must remain EXACTLY the same.
2. PRESERVE STRUCTURE: Pose, posture, hand gestures, and body shape must remain EXACTLY the same.
3. PRESERVE FRAMING: Camera angle, zoom, and composition must remain EXACTLY the same. DO NOT CROP. DO NOT ZOOM.
4. PRESERVE HAIR/HEAD: Keep hairstyle/hijab shape identical unless explicitly asked to change.

CHANGE REQUEST:
${prompt}`;

      return await ai.models.generateContent({
        model: model,
        contents: {
          parts: [
            { text: finalPrompt },
            { inlineData: { data: cleanBase64, mimeType: mimeType } },
          ],
        },
        config: { imageConfig: imageConfig }
      });
    };

    let response;
    try {
      if (selectedModel.includes('pro')) {
         response = await executeGenAI('gemini-3-pro-image-preview', true);
      } else {
         response = await executeGenAI('gemini-2.5-flash-image', false);
      }
    } catch (err: any) {
      console.warn(`Model ${selectedModel} failed. Reason:`, err.message);
      if (selectedModel.includes('pro')) {
        response = await executeGenAI('gemini-2.5-flash-image', false);
      } else {
        throw err;
      }
    }

    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }
    throw new Error("No image data returned from Gemini");
  } catch (error: any) {
    console.error("Gemini Generation Final Error:", error);
    throw error;
  }
};

export const generateVeoVideo = async (base64Image: string, prompt: string, outputRatio: AspectRatio) => {
  try {
    console.log("Initialize Veo Generation (Server-Side Vertex AI)...");

    // Veo support 16:9 or 9:16
    const veoAspectRatio = (outputRatio === '16:9' || outputRatio === '3:2') ? '16:9' : '9:16';

    const response = await fetch('/api/generate-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: base64Image,
        prompt: prompt,
        aspectRatio: veoAspectRatio
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server Error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.video) {
      throw new Error("Server returned success but no video data found.");
    }

    console.log("Video received from server!");

    // Convert Data URI to Blob
    const res = await fetch(data.video);
    const blob = await res.blob();
    return blob;

  } catch (error: any) {
    console.error("Veo Generation Error:", error);
    throw error;
  }
};