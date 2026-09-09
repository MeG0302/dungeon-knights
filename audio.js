// Audio System - Sound Effects and Background Music

class AudioManager {
    constructor() {
        this.sounds = {};
        this.music = null;
        this.menuMusic = null;
        this.sfxVolume = 0.5;
        this.musicVolume = 0.2; // Slow background sound
        this.isMuted = false;
        this.isMusicMuted = false;
        
        // Audio context for web audio
        this.audioContext = null;
        this.initAudioContext();
        
        // Load sound effects
        this.loadSounds();
    }
    
    initAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('⚠️ Web Audio API not supported');
        }
    }
    
    loadSounds() {
        // Using Zzfx - a tiny JavaScript sound effect generator
        // All sounds are procedurally generated (no files needed!)
        
        this.sounds = {
            // Combat sounds
            sword_hit: () => this.zzfx(0.15, 0, 523, .01, .03, .1, 1, 1.9, 0, 0, 0, 0, 0, 0, 0, 0, 0, .5, .01),
            monster_death: () => this.zzfx(0.2, 0, 261, .01, .1, .2, 3, 1.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, .5, .1),
            chest_break: () => this.zzfx(0.15, 0, 349, .02, .05, .15, 0, 1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, .6, .05),
            
            // Coin/Gold sounds
            coin_pickup: () => this.zzfx(0.2, 0, 698, .01, .03, .08, 1, 2.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, .5, .01),
            gold_earn: () => this.zzfx(0.25, 0, 880, .01, .05, .1, 1, 2.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, .7, .02),
            
            // UI sounds
            button_click: () => this.zzfx(0.1, 0, 440, .01, .01, .02, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, .5, 0),
            recruit: () => this.zzfx(0.3, 0, 523, .02, .15, .3, 1, 1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, .7, .05),
            deploy: () => this.zzfx(0.25, 0, 392, .03, .2, .3, 0, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, .6, .08),
            
            // Success/Completion sounds
            dungeon_complete: () => this.zzfx(0.4, 0, 659, .05, .3, .5, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, .8, .1),
            rare_drop: () => this.zzfx(0.35, 0, 784, .05, .25, .4, 1, 2.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, .75, .08),
            
            // Ambience
            footstep: () => this.zzfx(0.05, 0, 100, .01, .01, .03, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, .3, 0),
        };
        
        console.log('🔊 Audio system initialized with procedural sound effects');
        
        // Load background music
        this.loadBackgroundMusic();
        this.loadMenuMusic();
    }
    
    loadBackgroundMusic() {
        try {
            this.music = new Audio('music.mp3');
            this.music.loop = true;
            this.music.volume = this.musicVolume;
            this.music.muted = this.isMusicMuted;
            
            console.log('🎵 Background music loaded: music.mp3');
        } catch (e) {
            console.warn('⚠️ Failed to load background music', e);
        }
    }
    
    loadMenuMusic() {
        try {
            this.menuMusic = new Audio('menu-music.mp3');
            this.menuMusic.loop = true;
            this.menuMusic.volume = this.musicVolume * 0.8; // Slightly quieter for menus
            this.menuMusic.muted = this.isMusicMuted;
            
            console.log('🎵 Menu music loaded: menu-music.mp3');
        } catch (e) {
            console.warn('⚠️ Failed to load menu music', e);
        }
    }
    
    startMenuMusic() {
        if (this.menuMusic && !this.isMusicMuted) {
            // Stop game music if playing
            if (this.music) {
                this.music.pause();
                this.music.currentTime = 0;
            }
            
            // Resume audio context if needed
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            
            this.menuMusic.play().catch(err => {
                console.warn('⚠️ Menu music autoplay blocked. Will start on user interaction.', err);
            });
            console.log('🎵 Menu music started');
        }
    }
    
    stopMenuMusic() {
        if (this.menuMusic) {
            this.menuMusic.pause();
            this.menuMusic.currentTime = 0;
            console.log('🎵 Menu music stopped');
        }
    }
    
    startMusic() {
        if (this.music && !this.isMusicMuted) {
            // Resume audio context if needed
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            
            this.music.play().catch(err => {
                console.warn('⚠️ Music autoplay blocked. Will start on user interaction.', err);
            });
            console.log('🎵 Background music started');
        }
    }
    
    stopMusic() {
        if (this.music) {
            this.music.pause();
            this.music.currentTime = 0;
            console.log('🎵 Background music stopped');
        }
    }
    
    pauseMusic() {
        if (this.music) {
            this.music.pause();
        }
    }
    
    resumeMusic() {
        if (this.music && !this.isMusicMuted) {
            this.music.play().catch(err => {
                console.warn('⚠️ Failed to resume music', err);
            });
        }
    }
    
    // ZzFX - Zuper Zmall Zound Zynth
    // Micro JavaScript Sound FX System
    zzfx(volume=1, randomness=.05, frequency=220, attack=0, sustain=0, release=.1, shape=0, 
         shapeCurve=1, slide=0, deltaSlide=0, pitchJump=0, pitchJumpTime=0, repeatTime=0, 
         noise=0, modulation=0, bitCrush=0, delay=0, sustainVolume=1, decay=0, tremolo=0) {
        
        if (this.isMuted) return;
        
        // Get audio context
        let audioContext = this.audioContext;
        if (!audioContext) return;
        
        // Resume audio context if suspended (needed for mobile)
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        // Adjust volume
        volume *= this.sfxVolume;
        
        // Generate sound
        let sampleRate = audioContext.sampleRate;
        let length = attack + sustain + release;
        let lengthSamples = length * sampleRate;
        let buffer = audioContext.createBuffer(1, lengthSamples + delay * sampleRate, sampleRate);
        let data = buffer.getChannelData(0);
        
        let phase = 0;
        let phaseSpeed = frequency * 2 * Math.PI / sampleRate;
        let phaseSpeedDelta = slide * 2 * Math.PI / sampleRate / sampleRate;
        
        for (let i = 0; i < lengthSamples; i++) {
            let time = i / sampleRate;
            let envelope;
            
            if (time < attack) {
                envelope = time / attack;
            } else if (time < attack + sustain) {
                envelope = 1 - ((time - attack) / sustain) * (1 - sustainVolume);
            } else {
                envelope = ((time - attack - sustain) / release);
                envelope = sustainVolume - envelope * sustainVolume;
            }
            
            // Add randomness
            let rand = randomness * (2 * Math.random() - 1);
            
            // Generate wave
            let sample = shape ? 
                (phase % (2 * Math.PI) < Math.PI ? 1 : -1) : // Square wave
                Math.sin(phase); // Sine wave
            
            // Apply envelope and noise
            sample = sample * envelope * volume + rand * envelope;
            
            data[i] = sample;
            
            phase += phaseSpeed;
            phaseSpeed += phaseSpeedDelta;
        }
        
        // Play sound
        let source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start();
    }
    
    play(soundName) {
        if (this.isMuted) return;
        
        const soundFunc = this.sounds[soundName];
        if (soundFunc) {
            try {
                soundFunc();
            } catch (e) {
                console.warn(`Failed to play sound: ${soundName}`, e);
            }
        }
    }
    
    playWithDelay(soundName, delay) {
        setTimeout(() => this.play(soundName), delay);
    }
    
    playRandom(soundNames) {
        const sound = soundNames[Math.floor(Math.random() * soundNames.length)];
        this.play(sound);
    }
    
    setSfxVolume(volume) {
        this.sfxVolume = Math.max(0, Math.min(1, volume));
    }
    
    setMusicVolume(volume) {
        this.musicVolume = Math.max(0, Math.min(1, volume));
        if (this.music) {
            this.music.volume = this.musicVolume;
        }
    }
    
    toggleMute() {
        this.isMuted = !this.isMuted;
        return this.isMuted;
    }
    
    toggleMusicMute() {
        this.isMusicMuted = !this.isMusicMuted;
        if (this.music) {
            this.music.muted = this.isMusicMuted;
        }
        return this.isMusicMuted;
    }
    
    getMuteState() {
        return {
            sfx: this.isMuted,
            music: this.isMusicMuted
        };
    }
}

// Global audio manager instance
window.audioManager = new AudioManager();
