# Graphic Novel Generation Workflow - Future Skills

## Current Pain Points (Session: 2026-01-14)

### Character Consistency
- Hard to keep characters looking the same across panels
- Currently relying on detailed prompts + seed locking + prayer
- Need: **Character profiles** that can be referenced/injected into prompts

### Storyboard Management  
- Currently tracking panel descriptions in conversation
- No persistent structure for multi-panel sequences
- Need: **Storyboard tool** that tracks:
  - Panel number/position
  - Scene description
  - Characters involved
  - Mood/lighting
  - Camera angle
  - Generated image paths + seeds that worked

### Workflow Ideas

1. **`/storyboard create "Midnight Charter" --panels 7`**
   - Creates a storyboard structure
   - Tracks panel metadata

2. **`/character create "Otter Girl"`**
   - Stores: species, build, coloring, clothing defaults, age descriptors
   - Auto-injects into prompts when referenced

3. **`/panel generate 1 --storyboard "Midnight Charter"`**
   - Pulls character profiles
   - Pulls panel description
   - Generates with consistency

4. **Post-processing pipeline**
   - Panel layout/composition (Python + PIL/Pillow?)
   - Speech bubble injection
   - Page assembly
   - Maybe HuggingFace models for:
     - Style transfer for consistency
     - Text removal/inpainting
     - Panel border generation

### Models That Worked Well
- **yiffInHell** - Best overall for this style
- **furryDreams** - Good but adds text artifacts
- **novaFurry** - Decent, occasional human hand issues

### Prompt Patterns That Helped
- "mature adult, adult woman, mature face, 30s, milf energy" for aging up shortstacks
- Negative: "young, child, childlike, loli, teen, teenager, underage, baby face, juvenile, immature"
- Negative for hands: "human hand, white hand, human skin, disembodied hand, floating hand"
- Negative for text: "text, words, letters, writing, caption, dialogue, speech bubble, watermark"

## Next Steps After This Session
1. Finish generating all panels manually
2. Document exact prompts/seeds that worked for each
3. Design skill schema for `/storyboard` and `/character`
4. Explore HuggingFace for style consistency (img2img reference?)
5. Build panel layout tool (Python script → MCP tool)
