import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Upload, 
  Image as ImageIcon, 
  Trash2, 
  Settings, 
  Download, 
  Wand2, 
  Loader2, 
  AlertCircle,
  Maximize,
  Copy,
  Key,
  LogOut,
  ShieldCheck,
  X,
  Zap
} from 'lucide-react';
import { ReferenceImage, AppConfig, Resolution, AIStudio } from './types';
import { fileToBase64, getMimeType, removeBackground } from './utils';

// Constants
const GREEN_SCREEN_HEX = '#00FF00'; // Bright green for chroma key
const MODEL_NAME = 'gemini-3-pro-image-preview';
const DAILY_DEMO_LIMIT = 3;

export default function App() {
  // State
  const [hasKey, setHasKey] = useState(false); // True if AI Studio or valid user key
  const [userProvidedKey, setUserProvidedKey] = useState('');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyModalMessage, setKeyModalMessage] = useState(''); // Custom message for modal
  
  // Demo Limit State
  const [demoUsage, setDemoUsage] = useState(0);

  const [refImages, setRefImages] = useState<ReferenceImage[]>([]);
  const [config, setConfig] = useState<AppConfig>({
    resolution: '1K',
    backgroundColor: '#FACC15', // Default yellow
    isTransparent: false,
    sheetSize: '4x6',
    customWidth: 4,
    customHeight: 6,
    numberOfSheets: 1,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to access AIStudio from window safely
  const getAIStudio = (): AIStudio | undefined => (window as any).aistudio;

  // Check API Key on mount
  useEffect(() => {
    const checkKey = async () => {
      try {
        const aiStudio = getAIStudio();
        if (aiStudio && await aiStudio.hasSelectedApiKey()) {
          setHasKey(true);
        }
      } catch (e) {
        console.error("Error checking API key:", e);
      }
    };
    checkKey();
    
    // Initialize demo usage
    const usage = getDailyDemoUsage();
    setDemoUsage(usage);
  }, []);

  // Demo Usage Logic
  const getDailyDemoUsage = (): number => {
    try {
      const today = new Date().toDateString();
      const stored = localStorage.getItem('sticker_genius_demo_usage');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.date === today) {
          return parsed.count;
        }
      }
      return 0;
    } catch {
      return 0;
    }
  };

  const incrementDemoUsage = () => {
    const current = getDailyDemoUsage();
    const today = new Date().toDateString();
    const newCount = current + 1;
    localStorage.setItem('sticker_genius_demo_usage', JSON.stringify({
      date: today,
      count: newCount
    }));
    setDemoUsage(newCount);
  };

  // Handle API Key Selection from Modal
  const handleManualKeySubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (userProvidedKey.trim().length > 10) {
          setHasKey(true);
          setShowKeyModal(false);
          setError(null);
      } else {
          setError("Invalid API Key");
      }
  };

  const handleLogout = () => {
    setHasKey(false);
    setUserProvidedKey('');
  };

  // Image Upload Handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files: File[] = Array.from(e.target.files);
      
      const newImages: ReferenceImage[] = [];
      for (const file of files) {
        try {
          const base64 = await fileToBase64(file);
          const mimeType = getMimeType(file);
          newImages.push({
            id: Math.random().toString(36).substr(2, 9),
            data: base64,
            mimeType,
          });
        } catch (err) {
          console.error("Failed to process file", err);
        }
      }
      setRefImages(prev => [...prev, ...newImages]);
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (id: string) => {
    setRefImages(prev => prev.filter(img => img.id !== id));
  };

  // Single Sheet Generation Helper
  const generateSingleSheet = async (ai: GoogleGenAI, promptText: string, index: number): Promise<string> => {
    // 1. Prepare payload
    const parts = refImages.map(img => ({
      inlineData: {
        mimeType: img.mimeType,
        data: img.data
      }
    }));
    parts.push({ text: promptText } as any);

    // 2. Call API
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: "3:4", 
          imageSize: config.resolution
        }
      }
    });

    // 3. Extract Image
    let rawImageSrc: string | null = null;
    if (response.candidates && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
            rawImageSrc = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            break;
        }
      }
    }

    if (!rawImageSrc) {
      throw new Error(`Sheet ${index + 1}: No image generated.`);
    }

    // 4. Post-Processing (Transparency)
    if (config.isTransparent) {
      return await removeBackground(rawImageSrc, GREEN_SCREEN_HEX, 100);
    } else {
      return rawImageSrc;
    }
  };

  // Generation Logic
  const handleGenerate = async () => {
    setError(null);
    
    // Determine which key to use
    let apiKeyToUse = userProvidedKey;
    const envKey = process.env.API_KEY;
    const isUsingDemoKey = !apiKeyToUse && !!envKey;
    const aiStudio = getAIStudio();

    // Logic: 
    // 1. If User Key exists -> Use it (Unlimited)
    // 2. If AI Studio -> Use it (Unlimited)
    // 3. If Env Key exists -> Check Limit -> Use it OR Fail
    // 4. Else -> Prompt for Key
    
    if (!apiKeyToUse && !aiStudio) {
      if (envKey) {
        // Check Limit
        const currentUsage = getDailyDemoUsage();
        if (currentUsage >= DAILY_DEMO_LIMIT) {
          setKeyModalMessage("Daily free limit reached.");
          setShowKeyModal(true);
          return;
        }
        apiKeyToUse = envKey;
      } else {
        setKeyModalMessage("");
        setShowKeyModal(true);
        return;
      }
    }

    if (refImages.length === 0) {
      setError("Please upload at least one reference image.");
      return;
    }

    setIsGenerating(true);
    setGeneratedImages([]);
    
    const sheetCount = config.numberOfSheets;
    setStatusMessage(`Initializing Gemini 3 Pro for ${sheetCount} sheet(s)...`);

    try {
      const ai = new GoogleGenAI({ apiKey: apiKeyToUse });

      const bgColorDesc = config.isTransparent 
        ? `a solid, bright green color (Hex: ${GREEN_SCREEN_HEX})` 
        : `a solid color (Hex: ${config.backgroundColor})`;
      
      let sizeString = "4''x6''";
      if (config.sheetSize === '8.5x11') sizeString = "8.5''x11''";
      else if (config.sheetSize === 'custom') sizeString = `${config.customWidth}''x${config.customHeight}''`;

      const promptText = `
        A high-fidelity, full-body sticker sheet illustration, sized ${sizeString}. 
        The sheet features ${refImages.length} individual die-cut sticker illustrations of different, recognizable characters (based on the provided reference images).
        
        Sticker Content Requirements:
        Character Style: Smooth, glossy, stylized 3D render, like a vinyl collectible figure. CRITICAL: You must strictly retain all unique identifying features, colors, clothing, and ACCESSORIES (e.g., hats, glasses, items held) from the reference image.
        Anatomy & Posing: The character must strictly adhere to its four-legged anatomy, and must not display any additional arms or hands (e.g., no thumbs-up, crossed arms, or cheering with hands). All poses must be achieved using only its head, face, and body.
        Character Expressions: Each of the stickers must display a unique, exaggerated, funny, and expressive facial expression (e.g., angry, laughing, crying, confused), avoiding generic emoji-style faces.
        Text: Include exactly ONE single word (e.g., 'YAY!', 'LOL', 'GRRR!') placed strictly NEXT TO its corresponding sticker. Use a handwritten, comic-style font. Do NOT use sentences or multiple words.
        Die-Cut Style: Each individual sticker must have a clean, thick white die-cut outline/border.
        Layout: Arrange the stickers in a flexible, non-grid, and appealing layout across the sheet. CRITICAL: Ensure ample spacing between all stickers. They must NOT overlap each other or the text. Each sticker must be fully separated.
        
        Background & Lighting:
        The overall background for the sticker sheet must be ${bgColorDesc}. 
        Use isolated, clear lighting to make the 3D-rendered stickers pop against the background.
        Ensure the background color is uniform and flat to facilitate easy removal if needed.
      `;

      setStatusMessage(`Generating ${sheetCount} sticker sheet(s)... This may take a moment.`);

      // Create array of promises for concurrent generation
      const promises = Array.from({ length: sheetCount }).map((_, i) => 
        generateSingleSheet(ai, promptText, i)
      );

      const results = await Promise.allSettled(promises);
      
      const successfulImages: string[] = [];
      const errors: string[] = [];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successfulImages.push(result.value);
        } else {
          errors.push(`Sheet ${index + 1} failed: ${result.reason?.message || 'Unknown error'}`);
        }
      });

      if (successfulImages.length > 0) {
        setGeneratedImages(successfulImages);
        // Only increment limit if NOT using user key and NOT using AI studio
        if (isUsingDemoKey) {
          incrementDemoUsage();
        }
        if (errors.length > 0) {
          setError(`Generated ${successfulImages.length} sheet(s), but some failed: ${errors.join('; ')}`);
        }
      } else {
        throw new Error(errors.join('; ') || "All generations failed.");
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate stickers. Please try again.");
    } finally {
      setIsGenerating(false);
      setStatusMessage('');
    }
  };

  const downloadImage = (src: string, index: number) => {
    const link = document.createElement('a');
    link.href = src;
    link.download = `sticker-sheet-${index + 1}-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Determine if we are in "Demo Mode" (Using env key, no user key)
  const isDemoMode = !userProvidedKey && !getAIStudio() && !!process.env.API_KEY;

  return (
    <div className="min-h-screen bg-yellow-50 flex flex-col">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-yellow-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center shadow-sm">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-green-600 to-yellow-500">
              StickerGenius
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-600">
             <span className="hidden sm:inline-block font-medium">Powered by Gemini 3 Pro</span>
             {userProvidedKey && (
               <button 
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors text-xs font-semibold"
                title="Clear API Key"
              >
                <LogOut className="w-3.5 h-3.5" />
                Clear Key
               </button>
             )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8 gap-8 grid lg:grid-cols-[400px_1fr]">
        
        {/* Left Panel: Controls */}
        <div className="flex flex-col gap-6 h-fit">
          
          {/* Section: Upload */}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-yellow-100">
            <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-green-600" /> Reference Images
            </h2>
            
            <div className="grid grid-cols-2 gap-3 mb-4">
              {refImages.map((img) => (
                <div key={img.id} className="relative group aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                  <img src={`data:${img.mimeType};base64,${img.data}`} alt="Ref" className="w-full h-full object-cover" />
                  <button 
                    onClick={() => removeImage(img.id)}
                    className="absolute top-1 right-1 p-1 bg-white/80 backdrop-blur-sm rounded-full text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              
              <label className="aspect-square rounded-xl border-2 border-dashed border-green-300 hover:border-green-500 bg-green-50/50 hover:bg-green-50 transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 text-green-600">
                <Upload className="w-6 h-6" />
                <span className="text-xs font-medium">Add Image</span>
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="image/*"
                  multiple
                  className="hidden" 
                />
              </label>
            </div>
            <p className="text-xs text-slate-400">
              Upload reference images. {refImages.length} image{refImages.length !== 1 ? 's' : ''} added.
            </p>
          </section>

          {/* Section: Configuration */}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-yellow-100">
            <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-green-600" /> Configuration
            </h2>

            <div className="space-y-6">
              
              {/* Sheet Size */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                  <Maximize className="w-4 h-4 text-slate-500"/> Sheet Size
                </label>
                <div className="flex flex-col gap-2">
                   <div className="flex gap-2">
                      <button
                        onClick={() => setConfig(prev => ({ ...prev, sheetSize: '4x6' }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                          config.sheetSize === '4x6'
                            ? 'bg-green-600 text-white shadow-md shadow-green-200'
                            : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        4" × 6"
                      </button>
                      <button
                        onClick={() => setConfig(prev => ({ ...prev, sheetSize: '8.5x11' }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                          config.sheetSize === '8.5x11'
                            ? 'bg-green-600 text-white shadow-md shadow-green-200'
                            : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        8.5" × 11"
                      </button>
                   </div>
                </div>
              </div>

              {/* Resolution */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Output Resolution</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['1K', '2K', '4K'] as Resolution[]).map((res) => (
                    <button
                      key={res}
                      onClick={() => setConfig(prev => ({ ...prev, resolution: res }))}
                      className={`py-2 rounded-lg text-sm font-medium transition-all ${
                        config.resolution === res
                          ? 'bg-green-600 text-white shadow-md shadow-green-200'
                          : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>

              {/* Background */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Background</label>
                <div className="flex flex-col gap-3">
                  {/* Transparent Option */}
                  <label className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${
                    config.isTransparent 
                      ? 'border-green-500 bg-green-50/50 ring-1 ring-green-500' 
                      : 'border-slate-200 hover:border-green-300'
                  }`}>
                    <input 
                      type="radio" 
                      name="bgType"
                      checked={config.isTransparent}
                      onChange={() => setConfig(prev => ({ ...prev, isTransparent: true }))}
                      className="w-4 h-4 text-green-600 border-gray-300 focus:ring-green-500"
                    />
                    <span className="ml-3 text-sm text-slate-900">Transparent</span>
                  </label>

                  {/* Solid Color Option */}
                  <label className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${
                    !config.isTransparent 
                      ? 'border-green-500 bg-green-50/50 ring-1 ring-green-500' 
                      : 'border-slate-200 hover:border-green-300'
                  }`}>
                    <input 
                      type="radio" 
                      name="bgType"
                      checked={!config.isTransparent}
                      onChange={() => setConfig(prev => ({ ...prev, isTransparent: false }))}
                      className="w-4 h-4 text-green-600 border-gray-300 focus:ring-green-500"
                    />
                    <div className="ml-3 flex items-center gap-3 w-full">
                      <span className="text-sm text-slate-900">Solid Color</span>
                      <div className="flex-1 flex justify-end">
                         <div className="relative">
                           <input 
                             type="color" 
                             value={config.backgroundColor}
                             disabled={config.isTransparent}
                             onChange={(e) => setConfig(prev => ({ ...prev, backgroundColor: e.target.value }))}
                             className="w-8 h-8 rounded-full overflow-hidden border-2 border-slate-200 cursor-pointer disabled:opacity-50"
                           />
                         </div>
                      </div>
                    </div>
                  </label>
                </div>
              </div>

               {/* Number of Sheets */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                  <Copy className="w-4 h-4 text-slate-500"/> Quantity
                </label>
                <div className="flex gap-2 mb-2">
                   {[1, 3, 5].map((num) => (
                     <button
                       key={num}
                       onClick={() => setConfig(prev => ({ ...prev, numberOfSheets: num }))}
                       className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                         config.numberOfSheets === num
                           ? 'bg-green-600 text-white shadow-md shadow-green-200'
                           : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                       }`}
                     >
                       {num}
                     </button>
                   ))}
                </div>
              </div>

            </div>
          </section>

          {/* Action Button */}
          <div className="space-y-2">
            {isDemoMode && (
              <div className="flex items-center justify-between text-xs px-1">
                 <div className="flex items-center gap-1 text-slate-600">
                   <Zap className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                   <span>Free Demo Mode</span>
                 </div>
                 <span className={`font-semibold ${demoUsage >= DAILY_DEMO_LIMIT ? 'text-red-500' : 'text-green-600'}`}>
                   {Math.max(0, DAILY_DEMO_LIMIT - demoUsage)} / {DAILY_DEMO_LIMIT} free uses left today
                 </span>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={isGenerating || refImages.length === 0}
              className="w-full py-4 bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600 text-white font-bold rounded-2xl shadow-lg hover:shadow-xl shadow-yellow-200/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5" />
                  Generate Sticker Sheet
                </>
              )}
            </button>
          </div>
          
          {error && (
            <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Right Panel: Preview/Result */}
        <div className="flex flex-col h-full min-h-[500px] bg-yellow-100/30 rounded-2xl border-2 border-dashed border-yellow-200 overflow-hidden relative">
          
          {generatedImages.length > 0 ? (
             <div className="flex-1 p-8 bg-[url('https://www.transparenttextures.com/patterns/white-diamond.png')] overflow-y-auto">
                <div className="grid grid-cols-1 gap-12 w-full">
                  {generatedImages.map((src, index) => (
                    <div key={index} className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${index * 150}ms` }}>
                       <div className="w-full bg-white p-2 rounded shadow-sm mb-2 text-center text-sm font-medium text-slate-500">
                          Sheet #{index + 1}
                       </div>
                       <img 
                          src={src} 
                          alt={`Generated Sticker Sheet ${index + 1}`} 
                          className="max-w-full shadow-2xl rounded-sm object-contain mb-6"
                        />
                        <button 
                          onClick={() => downloadImage(src, index)}
                          className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-xl font-bold shadow-xl shadow-green-900/20 transition-all hover:-translate-y-1 flex items-center gap-2"
                        >
                          <Download className="w-5 h-5" />
                          Download Sheet #{index + 1}
                        </button>
                    </div>
                  ))}
                </div>

                <div className="mt-12 flex justify-center pb-8">
                   <button 
                     onClick={() => setGeneratedImages([])}
                     className="bg-white/90 backdrop-blur text-slate-800 px-6 py-3 rounded-xl font-bold shadow-xl shadow-slate-900/10 hover:bg-white transition-all hover:-translate-y-1"
                   >
                     Make Another Batch
                   </button>
                </div>
             </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
               {isGenerating ? (
                 <div className="text-center">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                      <Wand2 className="w-10 h-10 text-green-600 animate-bounce" />
                    </div>
                    <h3 className="text-xl font-semibold text-slate-700 mb-2">Creating Magic</h3>
                    <p className="text-slate-500 max-w-xs mx-auto mb-4">{statusMessage}</p>
                    <div className="w-64 h-2 bg-slate-200 rounded-full mx-auto overflow-hidden">
                      <div className="h-full bg-green-600 rounded-full animate-[progress_2s_ease-in-out_infinite] w-1/2"></div>
                    </div>
                 </div>
               ) : (
                 <div className="text-center">
                   <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm border border-yellow-100">
                     <ImageIcon className="w-10 h-10 text-yellow-300" />
                   </div>
                   <h3 className="text-lg font-medium text-slate-600 mb-2">No Stickers Generated Yet</h3>
                   <p className="max-w-sm mx-auto text-sm">
                     Upload reference images and configure your settings on the left to create your custom sticker sheet.
                   </p>
                 </div>
               )}
            </div>
          )}
        </div>

      </main>

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200 relative">
               <button 
                 onClick={() => setShowKeyModal(false)}
                 className="absolute top-4 right-4 p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600"
               >
                 <X className="w-5 h-5" />
               </button>
               
               <div className="p-8">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
                     <Key className="w-6 h-6 text-green-600" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-900 mb-2">
                    {keyModalMessage ? "Free Limit Reached" : "API Key Required"}
                  </h2>
                  <p className="text-slate-600 text-sm mb-6">
                    {keyModalMessage || "To generate images, you need to provide your own Google Cloud API Key."}
                  </p>
                  
                  <form onSubmit={handleManualKeySubmit} className="flex flex-col gap-4">
                      <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Your API Key</label>
                          <input 
                              type="password"
                              value={userProvidedKey}
                              onChange={(e) => setUserProvidedKey(e.target.value)}
                              placeholder="AIzaSy..."
                              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-green-500 focus:ring-2 focus:ring-green-200 outline-none transition-all"
                              autoFocus
                          />
                      </div>
                      
                      <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 p-3 rounded-lg text-left">
                         <ShieldCheck className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                         <p>Your key is stored in browser memory only and is never sent to our servers.</p>
                      </div>

                      <button 
                          type="submit"
                          className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-green-200 hover:shadow-green-300 mt-2"
                      >
                          Save & Continue
                      </button>
                  </form>
                  
                  <div className="mt-6 pt-6 border-t border-slate-100 text-xs text-center text-slate-400">
                     <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="underline hover:text-green-600 font-medium">
                       Get a free API key from Google AI Studio
                     </a>
                  </div>
               </div>
            </div>
        </div>
      )}
      
      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}