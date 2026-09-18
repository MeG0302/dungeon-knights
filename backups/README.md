# 🔄 Dungeon Knights - Backup & Restore

## 📦 Backup Created
**Date:** January 2025
**Reason:** Before adding animated video map backgrounds

## 📁 Backed Up Files
- `index.html` - Main game page HTML
- `game.js` - Game logic
- `dungeon.js` - Dungeon rendering system
- `medieval-game.css` - Game page styling

## 🔙 How to Restore

### Option 1: Windows (Double-click)
```
Run: RESTORE.bat
```

### Option 2: PowerShell
```powershell
.\RESTORE.ps1
```

### Option 3: Manual Restore
Copy files from `before-video-maps/` back to project root:
```
before-video-maps/index.html.backup → ../index.html
before-video-maps/game.js.backup → ../game.js
before-video-maps/dungeon.js.backup → ../dungeon.js
before-video-maps/medieval-game.css.backup → ../medieval-game.css
```

## ⚠️ Important Notes

1. **Backup Location**: `d:\dungeon knights robinhood\backups\before-video-maps\`
2. **Restore will overwrite current files** - make sure you want to restore!
3. **Video files won't be removed** - they'll just stop being used
4. **This restores the tile-based rendering system** (before video backgrounds)

## 🎮 What Changed in New Version

**Added:**
- Video background layer behind game canvas
- Animated dungeon environments (5 videos)
- Transparent canvas rendering
- Video switching system for different dungeons

**Kept:**
- All game logic (knights, combat, movement)
- All existing rendering (just made background transparent)
- All UI elements
- All functionality

## 📞 Need Help?
If restore doesn't work, manually copy the `.backup` files from `before-video-maps/` folder.
