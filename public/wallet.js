// Wallet Manager with Direct Web3 Integration
//
// Where the provider comes from is not decided here — `public/wallet-source.js` (loaded
// before this file) settles that: an injected extension when there is one, an embedded
// wallet when the server is configured for it, and nothing at all otherwise. Everything
// below still speaks plain EIP-1193, so the same code serves both.
console.log('🔧 Loading wallet.js...');

class WalletManager {
  constructor() {
    this.provider = null;
    this.userAddress = null;
    this.isConnected = false;
    // 'injected' or 'embedded' — read by the UI when it needs to say which wallet is in
    // use (an embedded one has to be funded before it can pay gas).
    this.walletKind = null;
    
    // Contract addresses.
    //
    // Read from `config.js`, which every page loads before this file — but the literals below
    // are the same addresses rather than a guess, so a page that reached here without the
    // config still talks to the live collection.
    //
    // The two hardcoded here used to be the **first** collection (`0x06c7…`) and the first
    // $DNG (`0xA8D5…`). Phase 2 replaced both, and everything server-side moved with them —
    // while this file did not, which is how the Hall's roster could list knights the vault, the
    // dungeon and the reward contracts had all stopped recognising. One collection, one token.
    const readConfig = (fn) => (window.DUNGEON_CONFIG && typeof window.DUNGEON_CONFIG[fn] === 'function'
      ? window.DUNGEON_CONFIG[fn].call(window.DUNGEON_CONFIG)
      : null);
    // The collection was replaced a third time on 21 September (see `docs/DEPLOY-PHASE-2.md`),
    // which is why this fallback matters more than it looks: a stale value here makes the Hall's
    // summon approve and call a contract that cannot mint.
    this.nftContractAddress = readConfig('getNFTContract') || '0x27Cfbb763188a50Fe1C0fFfBe2552b1945eE1B2D';
    this.tokenContractAddress = readConfig('getTokenAddress') || '0x3D94e56E0d967633830f6d9E42CE43A64FFfD6Ca';
    
    // Chain config
    this.chainId = 46630; // Robinhood Chain Testnet
    this.chainIdHex = '0xB626'; // Fixed: 46630 in hex (was 0xB616 = 46614)
    
    console.log('✅ WalletManager initialized');
  }
  
  // Initialize wallet manager
  async init() {
    console.log('🔌 Initializing wallet...');

    // The source waits briefly for a late-injecting extension, then falls back to a
    // silently restored embedded session (no UI — a returning player is just signed in).
    const source = window.DKWallet;
    const provider = source
      ? await source.provider({ waitMs: 1000 })
      : (typeof window.ethereum !== 'undefined' ? window.ethereum : null);

    if (!provider) {
      console.warn('⚠️ No Web3 wallet available');
      return false;
    }

    this.provider = provider;
    this.walletKind = (source && source.kind && source.kind()) || 'injected';
    console.log('✅ Web3 provider found', this.walletKind === 'embedded' ? '(embedded wallet)' : '');
    
    // Check if already connected (from localStorage)
    const wasConnected = localStorage.getItem('walletConnected') === 'true';
    
    // Check if already connected
    try {
      const accounts = await this.provider.request({ 
        method: 'eth_accounts' 
      });
      
      if (accounts.length > 0 && wasConnected) {
        console.log('👤 Wallet already connected');
        this.userAddress = accounts[0];
        this.isConnected = true;
        
        // Save to localStorage
        localStorage.setItem('walletConnected', 'true');
        localStorage.setItem('walletAddress', this.userAddress);
        
        // Dispatch connected event
        window.dispatchEvent(new CustomEvent('walletConnected', { 
          detail: { address: this.userAddress } 
        }));
      }
    } catch (error) {
      console.error('❌ Failed to check existing connection:', error);
    }
    
    // Listen for account changes
    this.provider.on('accountsChanged', (accounts) => {
      if (accounts.length === 0) {
        this.onDisconnect();
      } else {
        this.userAddress = accounts[0];
        this.isConnected = true;
        localStorage.setItem('walletAddress', this.userAddress);
        window.dispatchEvent(new CustomEvent('walletConnected', { 
          detail: { address: this.userAddress } 
        }));
      }
    });
    
    // Listen for chain changes
    this.provider.on('chainChanged', () => {
      window.location.reload();
    });
    
    console.log('✅ Wallet manager ready');
    return true;
  }
  
  // Connect wallet
  async connect() {
    console.log('🔌 Connecting wallet...');

    if (!this.provider) {
      const source = window.DKWallet;
      if (source) {
        // Asks the source for a provider, which is where an embedded wallet's email
        // sign-in happens. Returns null when this browser has no wallet to offer.
        try {
          this.provider = await source.connect();
          this.walletKind = source.kind ? source.kind() : null;
        } catch (error) {
          console.error('❌ Wallet sign-in failed:', error);
          alert(error.message || 'Wallet sign-in failed. Please try again.');
          return false;
        }
      } else if (typeof window.ethereum !== 'undefined') {
        console.log('Found ethereum, setting provider...');
        this.provider = window.ethereum;
        this.walletKind = 'injected';
      }

      if (!this.provider) {
        // Honest about the device, and still useful on a desktop: the download link stays
        // for someone who can install an extension, and is not offered to a phone that
        // cannot.
        const mobile = source && source.isMobile && source.isMobile();
        alert((source && source.unavailableMessage && source.unavailableMessage())
          || 'Please install MetaMask or another Web3 wallet!');
        if (!mobile) window.open('https://metamask.io/download/', '_blank');
        return false;
      }
    }
    
    try {
      // Request account access
      const accounts = await this.provider.request({ 
        method: 'eth_requestAccounts' 
      });
      
      this.userAddress = accounts[0];
      this.isConnected = true;
      
      // Save to localStorage
      localStorage.setItem('walletConnected', 'true');
      localStorage.setItem('walletAddress', this.userAddress);
      
      console.log('✅ Connected:', this.userAddress);
      
      // Switch to Robinhood Chain
      await this.switchToRobinhoodChain();
      
      // Dispatch connected event
      window.dispatchEvent(new CustomEvent('walletConnected', { 
        detail: { address: this.userAddress } 
      }));
      
      return true;
      
    } catch (error) {
      console.error('❌ Connection failed:', error);
      if (error.code !== 4001) {
        alert('Connection failed: ' + error.message);
      }
      return false;
    }
  }
  
  // Switch to Robinhood Chain
  async switchToRobinhoodChain() {
    try {
      // First check current chain
      const currentChainId = await this.provider.request({ method: 'eth_chainId' });
      console.log('Current chain:', currentChainId, 'Target:', this.chainIdHex);
      
      if (currentChainId === this.chainIdHex) {
        console.log('✅ Already on Robinhood Chain');
        return;
      }
      
      // Try to switch
      await this.provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: this.chainIdHex }],
      });
      console.log('✅ Switched to Robinhood Chain');
    } catch (switchError) {
      console.log('Switch error code:', switchError.code);
      
      // Chain not added, try to add it
      if (switchError.code === 4902) {
        try {
          await this.provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: this.chainIdHex,
              chainName: 'Robinhood Testnet',
              nativeCurrency: {
                name: 'ETH',
                symbol: 'ETH',
                decimals: 18
              },
              rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
              blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com']
            }],
          });
          console.log('✅ Added Robinhood Chain');
        } catch (addError) {
          console.error('❌ Failed to add chain:', addError);
          
          // If it's already added but with a different name, just inform user
          if (addError.code === -32602 || addError.message?.includes('same RPC')) {
            console.log('⚠️ Chain already exists in MetaMask, please switch manually to Robinhood Chain Testnet');
            alert('Please switch to Robinhood Chain Testnet in MetaMask manually (it\'s already added with a different name)');
            return;
          }
          
          throw addError;
        }
      } else if (switchError.code === 4001) {
        // User rejected
        console.log('User rejected network switch');
        throw switchError;
      } else {
        console.error('❌ Failed to switch chain:', switchError);
        throw switchError;
      }
    }
  }
  
  // Disconnect wallet
  async disconnect() {
    // An embedded wallet is a real session on Privy's side: clearing localStorage alone
    // would sign the player back in on the next page load.
    if (this.walletKind === 'embedded' && window.DKWallet && window.DKWallet.disconnect) {
      await window.DKWallet.disconnect();
    }
    this.walletKind = null;
    this.onDisconnect();
  }
  
  // Handle disconnect
  onDisconnect() {
    console.log('👋 Wallet disconnected');
    this.isConnected = false;
    this.userAddress = null;
    
    // Clear localStorage
    localStorage.removeItem('walletConnected');
    localStorage.removeItem('walletAddress');
    
    window.dispatchEvent(new Event('walletDisconnected'));
  }
  
  // Get $DNG balance
  async getDNGBalance() {
    if (!this.isConnected) return '0';
    
    try {
      const tokenABI = [
        'function balanceOf(address) view returns (uint256)'
      ];
      
      const provider = new ethers.providers.Web3Provider(this.provider);
      const contract = new ethers.Contract(
        this.tokenContractAddress,
        tokenABI,
        provider
      );
      
      const balance = await contract.balanceOf(this.userAddress);
      return ethers.utils.formatEther(balance);
      
    } catch (error) {
      console.error('❌ Failed to get DNG balance:', error);
      return '0';
    }
  }
  
  // Approve $DNG tokens
  async approveDNG(amount, spender = null) {
    if (!this.isConnected) {
      alert('Please connect your wallet first!');
      return false;
    }
    
    try {
      console.log('💰 Approving', amount, '$DNG...');
      
      const tokenABI = [
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)'
      ];
      
      const provider = new ethers.providers.Web3Provider(this.provider);
      const signer = provider.getSigner();
      const contract = new ethers.Contract(
        this.tokenContractAddress,
        tokenABI,
        signer
      );
      
      const amountWei = ethers.utils.parseEther(amount.toString());

      // Who is allowed to take the $DNG. It is a parameter and not a constant because the two
      // paths differ: `summon()` moves the money from inside the **collection**, while
      // `Capsules.open()` moves it from inside the **capsule contract**. Approving the wrong
      // one reverts on transfer, at gas cost, with a failed transaction for the player.
      const spenderAddress = spender || this.nftContractAddress;

      // Check current allowance
      const allowance = await contract.allowance(this.userAddress, spenderAddress);
      
      if (allowance.gte(amountWei)) {
        console.log('✅ Already approved');
        return true;
      }
      
      // Request approval
      const tx = await contract.approve(spenderAddress, amountWei);
      console.log('⏳ Waiting for approval...');
      await tx.wait();
      
      console.log('✅ Approved!');
      return true;
      
    } catch (error) {
      console.error('❌ Approval failed:', error);
      if (error.code !== 4001) {
        alert('Approval failed: ' + error.message);
      }
      return false;
    }
  }
  
  // Mint knight
  /**
   * Summon one knight: `summon()` for `SUMMON_PRICE` $DNG, at the published drop rates.
   *
   * This replaced a `mintKnight()` call that **does not exist on the live collection** — the
   * Phase 2 `Knights` contract has `summon()` and `mintFromCapsule()` and nothing else, so the
   * old call would have reverted for every player who pressed the button.
   *
   * The price is read from the contract rather than from `config.js`, so the number the page
   * quoted and the number charged come from one place. The $DNG is pulled by the collection
   * itself (it forwards it into the reward vault), which is why the approval below names the
   * NFT contract as its spender — approving the token address, or the vault, would leave
   * `summon()` unable to transfer and it would revert on the allowance check.
   */
  /**
   * The gas limit to send `summon()` with — the estimate, plus a margin that is not optional.
   *
   * `_mintTier` writes `rarityOf[tokenId] = rarity`, and a **Common** roll is tier `0`, so that
   * write is zero-into-zero: an SSTORE of 100 gas instead of 20,000. `eth_estimateGas` runs against
   * one block's randomness, so an estimate taken when the draw is Common can be ~20k short of what
   * a transaction that lands on Uncommon or better will actually cost. The result is a transaction
   * that reverts out of gas — `status 0`, `gasUsed == gasLimit`, and the player pays for it.
   *
   * That is not a theory: the first real summon sent from our own deploy script died exactly this
   * way, at 246,527 of 246,527. A fixed limit would have to be sized for the worst tier and would
   * overpay on every Common, so the estimate is buffered instead.
   */
  async summonGasLimit(contract) {
    const estimate = await contract.estimateGas.summon();
    return estimate.mul(130).div(100);
  }

  async summonKnight() {
    if (!this.isConnected) {
      alert('Please connect your wallet first!');
      return null;
    }

    try {
      const provider = new ethers.providers.Web3Provider(this.provider);
      const signer = provider.getSigner();
      const contract = new ethers.Contract(this.nftContractAddress, [
        'function summon() returns (uint256)',
        'function SUMMON_PRICE() view returns (uint256)'
      ], signer);

      const price = await contract.SUMMON_PRICE();
      const approved = await this.approveDNG(ethers.utils.formatEther(price));
      if (!approved) throw new Error('Token approval failed');

      const tx = await contract.summon({ gasLimit: await this.summonGasLimit(contract) });
      const receipt = await tx.wait();

      return { success: true, txHash: tx.hash, blockNumber: receipt.blockNumber };
    } catch (error) {
      console.error('❌ Summon failed:', error);
      if (error.code !== 4001) alert('Summon failed: ' + error.message);
      return null;
    }
  }

  // ------------------------------------------------------------------ capsules
  //
  // Capsules are minted by the weekly raffle, never sold, and opening one burns it and
  // mints a Knight at the published odds. The address lives in `config.js` and is empty
  // until the collection is deployed — which is why every method below reports "not
  // deployed" rather than attempting a call against nothing.

  capsuleContractAddress() {
    const read = window.DUNGEON_CONFIG && window.DUNGEON_CONFIG.getCapsuleContract;
    const address = typeof read === 'function' ? read.call(window.DUNGEON_CONFIG) : null;
    return address && String(address).length > 10 ? String(address) : null;
  }

  /**
   * How many capsules this wallet holds, or `null` when there is nothing to read from.
   *
   * **Capsules are ERC-1155, so `balanceOf` takes a token id as well as an owner.** This used
   * the ERC-20/721 one-argument form, which reverts against the real contract — and because the
   * revert is caught below it would have reported `null` for every wallet with capsules in it:
   * not an error on screen, just a player who won one and cannot see it. The ids are
   * `1..TYPE_COUNT` (the contract rejects `0`), and the four rungs are what
   * `contracts/Capsules.sol` publishes, so the sum is "capsules held" rather than "capsules of
   * one rung".
   */
  async getMyCapsules() {
    const balances = await this.capsuleBalances();
    return balances ? balances.reduce((sum, value) => sum + value, 0) : null;
  }

  /**
   * How many capsules this wallet holds **per rung**, lowest first, or `null` when there is
   * nothing to read from.
   *
   * Per rung rather than as a total, because `Capsules.open(capsuleId, amount)` names the rung
   * it burns: a wallet holding three Rare capsules and no Common ones cannot open "three
   * capsules", it can open three *Rare* capsules. The total is derived from this — see
   * `getMyCapsules` — so the two can never disagree about what is held.
   */
  async capsuleBalances() {
    const address = this.capsuleContractAddress();
    if (!address || !this.isConnected || !this.provider) return null;

    const CAPSULE_TYPE_COUNT = 4; // Capsules.sol `TYPE_COUNT` — ids are 1-based.

    try {
      const provider = new ethers.providers.Web3Provider(this.provider);
      const contract = new ethers.Contract(address, [
        'function balanceOf(address owner, uint256 id) view returns (uint256)'
      ], provider);
      const balances = await Promise.all(
        Array.from({ length: CAPSULE_TYPE_COUNT }, (_, i) => contract.balanceOf(this.userAddress, i + 1))
      );
      return balances.map((value) => value.toNumber());
    } catch (error) {
      console.warn('Could not read capsule balance:', error.message);
      return null;
    }
  }

  /**
   * Open `quantity` capsules.
   *
   * The price is read *from the contract* rather than passed in, so the figure the page
   * quoted cannot drift from the figure the player is charged. Both come from the same
   * published economy — the page from `/api/staking/config`, the contract from its own
   * `openPrice()` — and this approval is sized off the latter.
   */
  async openCapsules(quantity) {
    const address = this.capsuleContractAddress();
    if (!address) return { success: false, error: 'The Capsules collection is not deployed yet.' };
    if (!this.isConnected) {
      alert('Please connect your wallet first!');
      return { success: false, error: 'Not connected' };
    }

    // The rung has to be named, and it has to be one the wallet holds: `open()` burns what it
    // is told to burn, so opening rung 1 on a wallet holding only rung 3 reverts. Lowest rung
    // with enough capsules first — a rarer capsule is worth keeping, and spending it should be
    // a choice rather than something a "x3" button does on the player's behalf.
    const held = await this.capsuleBalances();
    const enough = held ? held.findIndex((n) => n >= quantity) : -1;
    let capsuleId = enough >= 0 ? enough + 1 : 0;
    if (!capsuleId) {
      const any = held ? held.findIndex((n) => n > 0) : -1;
      if (any < 0) return { success: false, error: 'This wallet holds no capsules to open.' };
      capsuleId = any + 1;
      quantity = held[any];
    }

    try {
      const provider = new ethers.providers.Web3Provider(this.provider);
      const signer = provider.getSigner();
      const contract = new ethers.Contract(address, [
        'function open(uint256 capsuleId, uint256 amount)',
        'function openPrice() view returns (uint256)'
      ], signer);

      const costPer = await contract.openPrice();
      const cost = costPer.mul(quantity);

      // The capsules contract takes the money itself (and forwards it into the vault), so it —
      // not the collection — is the spender this approval has to name.
      const approved = await this.approveDNG(ethers.utils.formatEther(cost), address);
      if (!approved) throw new Error('Token approval failed');

      const tx = await contract.open(capsuleId, quantity);
      const receipt = await tx.wait();
      return { success: true, txHash: tx.hash, blockNumber: receipt.blockNumber, capsuleId, count: quantity };
    } catch (error) {
      console.error('❌ Capsule open failed:', error);
      return { success: false, error: error.code === 4001 ? 'Cancelled' : error.message };
    }
  }

  // Batch mint knights (up to 10 in parallel)
  async batchMintKnights(quantity) {
    if (!this.isConnected) {
      alert('Please connect your wallet first!');
      return null;
    }

    if (quantity < 1 || quantity > 10) {
      alert('Can only mint 1-10 knights at a time');
      return null;
    }

    try {
      console.log(`⚔️ Batch minting ${quantity} knights...`);
      
      // `summon()` is the only way a knight enters circulation, it charges `SUMMON_PRICE`
      // each time, and it takes no count — so "batch" is one approval followed by one
      // transaction per knight. Sent **sequentially on purpose**: each one needs the nonce the
      // previous one consumed, and firing them concurrently is how a wallet ends up with a
      // replaced transaction and a player wondering which knight they paid for.
      const contract = new ethers.Contract(this.nftContractAddress, [
        'function summon() returns (uint256)',
        'function SUMMON_PRICE() view returns (uint256)'
      ], provider.getSigner());

      const price = await contract.SUMMON_PRICE();
      const total = ethers.utils.formatEther(price.mul(quantity));
      const approved = await this.approveDNG(total);
      if (!approved) throw new Error('Token approval failed');

      const results = [];
      for (let i = 0; i < quantity; i++) {
        console.log(`📝 Summoning knight ${i + 1}/${quantity}...`);
        // Re-estimated per knight, because the cost *changes* with the tier that gets rolled — see
        // `summonGasLimit` below. Reusing the first estimate for the whole batch would reintroduce
        // the same failure the buffer exists to prevent.
        const tx = await contract.summon({ gasLimit: await this.summonGasLimit(contract) });
        const receipt = await tx.wait();
        results.push({ success: true, txHash: tx.hash, blockNumber: receipt.blockNumber });
      }

      console.log(`🎉 All ${quantity} knights summoned`);
      
      return {
        success: true,
        count: quantity,
        results: results
      };
      
    } catch (error) {
      console.error('❌ Batch mint failed:', error);
      if (error.code !== 4001) {
        alert('Batch mint failed: ' + error.message);
      }
      return null;
    }
  }
  
  // Get knights from blockchain
  async getMyKnights() {
    if (!this.isConnected) return [];
    
    try {
      console.log('📦 Fetching knights from blockchain...');
      
      // Read by **ownership**, not by scanning token ids.
      //
      // The old ABI asked for `totalMinted()` and swept `0…totalMinted` — a function the live
      // collection does not have, and a loop that gets slower with every knight ever minted.
      // `Knights.sol` is `ERC721Enumerable`, so the wallet's own tokens are indexed and this is
      // `balanceOf` plus that many lookups. `getKnightInfo` is the one call kept from the old
      // interface: the collection deliberately publishes the same shape so the game contract
      // and this page do not need a second reader.
      const nftABI = [
        'function balanceOf(address) view returns (uint256)',
        'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
        'function getKnightInfo(uint256 tokenId) view returns (address owner, uint8 rarity, string memory rarityName)'
      ];
      
      const provider = new ethers.providers.Web3Provider(this.provider);
      const contract = new ethers.Contract(
        this.nftContractAddress,
        nftABI,
        provider
      );
      
      const balance = await contract.balanceOf(this.userAddress);
      const knightCount = balance.toNumber();
      
      console.log('Found', knightCount, 'knights');
      
      if (knightCount === 0) return [];
      
      const knights = [];
      const rarityNames = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

      for (let i = 0; i < knightCount; i++) {
        const tokenId = await contract.tokenOfOwnerByIndex(this.userAddress, i);
        const info = await contract.getKnightInfo(tokenId);
        knights.push({
          tokenId: tokenId.toNumber(),
          rarity: rarityNames[info.rarity] || 'common',
          owner: info.owner
        });
      }
      
      console.log('✅ Loaded', knights.length, 'knights');
      return knights;
      
    } catch (error) {
      console.error('❌ Failed to fetch knights:', error);
      return [];
    }
  }
}

// Create global instance
console.log('🔧 Creating global WalletManager...');
window.walletManager = new WalletManager();

// Initialize immediately when script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('🎯 DOM ready, initializing wallet...');
    window.walletManager.init();
  });
} else {
  // DOM already loaded
  console.log('🎯 DOM already ready, initializing wallet...');
  window.walletManager.init();
}

console.log('✅ wallet.js loaded');
