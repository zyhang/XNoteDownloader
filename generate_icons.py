
import os
from PIL import Image, ImageDraw, ImageFont

def generate_icon(size, filename):
    # Colors
    bg_color = (255, 255, 255)
    border_color = (207, 217, 222) # Light gray-blue from Grok button
    text_color = (15, 20, 25)      # Black/Dark Gray
    
    # Create image with transparent background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw circular background
    # Improve anti-aliasing by drawing larger and resizing? 
    # For simplicity, we'll draw directly. For production high-res, supersampling is better.
    # Let's do 4x supersampling for smoothness.
    scale = 4
    large_size = size * scale
    large_img = Image.new('RGBA', (large_size, large_size), (0, 0, 0, 0))
    large_draw = ImageDraw.Draw(large_img)
    
    # Draw circle
    large_draw.ellipse((0, 0, large_size-1, large_size-1), fill=bg_color)
    
    # Draw border (stroke) - scale the width
    stroke_width = max(1, int(1 * scale))  # 1px border at normal size
    if size > 48: stroke_width = int(1.5 * scale) # slightly thicker for large icons
    
    large_draw.ellipse((0, 0, large_size-1, large_size-1), outline=border_color, width=stroke_width)
    
    # Text
    text = "X" if size <= 32 else "XNote"
    
    # Load Font
    # Try to find a bold san-serif font on macOS
    font_path = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
    if not os.path.exists(font_path):
        font_path = "/System/Library/Fonts/Helvetica.ttc" # Fallback
        
    try:
        # Calculate font size roughly
        if size <= 32:
            font_size = int(size * 0.6) * scale
        else:
            font_size = int(size * 0.25) * scale # smaller for full text
            
        font = ImageFont.truetype(font_path, font_size)
    except IOError:
        print(f"Warning: Could not load system font. Using default.")
        font = ImageFont.load_default()
        
    # Measure text
    try:
        left, top, right, bottom = large_draw.textbbox((0, 0), text, font=font)
        text_width = right - left
        text_height = bottom - top
    except AttributeError:
        # Fallback for older PIL
        text_width, text_height = large_draw.textsize(text, font=font)
        
    # Center text
    x = (large_size - text_width) / 2
    y = (large_size - text_height) / 2 - (text_height * 0.1) # nudge up slightly for optical center
    
    large_draw.text((x, y), text, font=font, fill=text_color)
    
    # Resize down
    img = large_img.resize((size, size), Image.LANCZOS)
    
    # Save
    img.save(f"icons/{filename}")
    print(f"Generated icons/{filename}")

def main():
    if not os.path.exists('icons'):
        os.makedirs('icons')
        
    sizes = [
        (16, "icon16.png"),
        (32, "icon32.png"),
        (48, "icon48.png"),
        (128, "icon128.png")
    ]
    
    for size, name in sizes:
        generate_icon(size, name)

if __name__ == "__main__":
    main()
