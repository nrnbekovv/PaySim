use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("2ofjyfxxWxJRrt2xa2xEMbcn969Qp5qUW25MaVsmNuTg");

#[program]
pub mod paysim {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>, face: u64, coupon_bps: u16, frequency: u8, maturity: i64) -> Result<()> {
        require!(face > 0 && coupon_bps > 0 && coupon_bps <= 10000 && frequency == 2, PayError::Parameters);
        require!(ctx.accounts.settlement_mint.decimals == 6, PayError::Parameters);
        let now = Clock::get()?.unix_timestamp;
        require!(maturity >= now, PayError::Maturity);
        let bond = &mut ctx.accounts.bond;
        bond.issuer = ctx.accounts.issuer.key();
        bond.mint = ctx.accounts.mint.key();
        bond.settlement_mint = ctx.accounts.settlement_mint.key();
        bond.treasury = ctx.accounts.treasury.key();
        bond.face = face;
        bond.coupon_bps = coupon_bps;
        bond.frequency = frequency;
        bond.maturity = maturity;
        bond.issued = now;
        bond.bump = ctx.bumps.bond;
        Ok(())
    }

    pub fn register_holder(ctx: Context<RegisterHolder>, index: u8, amount: u64) -> Result<()> {
        let bond = &ctx.accounts.bond;
        require!(index < 3 && index == bond.registered && bond.next_action == 0 && amount > 0, PayError::Parameters);
        require!(!bond.holders.iter().take(bond.registered as usize).any(|h| h.wallet == ctx.accounts.holder.key()), PayError::Duplicate);
        let issuer = bond.issuer;
        let bump = [bond.bump];
        let seeds: &[&[u8]] = &[b"bond", issuer.as_ref(), &bump];
        token::mint_to(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), MintTo { mint: ctx.accounts.mint.to_account_info(), to: ctx.accounts.vault.to_account_info(), authority: ctx.accounts.bond.to_account_info() }, &[seeds]), amount)?;
        let bond = &mut ctx.accounts.bond;
        bond.holders[index as usize] = Holder { wallet: ctx.accounts.holder.key(), vault: ctx.accounts.vault.key(), settlement: ctx.accounts.receiver.key(), balance: amount };
        bond.registered += 1;
        Ok(())
    }

    pub fn snapshot(ctx: Context<Snapshot>, id: u64, kind: u8, record_day: i64, portion_bps: u16, price_bps: u16, period: u32) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let bond = &mut ctx.accounts.bond;
        require!(id == bond.next_action && bond.registered == 3 && kind <= 2, PayError::Parameters);
        require!(record_day == now.div_euclid(86400), PayError::RecordDate);
        require!(if kind == 2 { now >= bond.maturity } else { now <= bond.maturity }, PayError::Maturity);
        if kind == 0 { require!(period == coupon_period(now) && period > bond.last_coupon, PayError::Duplicate); }
        if kind == 1 { require!(portion_bps > 0 && portion_bps <= 10000 && price_bps >= 10000 && price_bps <= 20000, PayError::Parameters); }
        let action = &mut ctx.accounts.action;
        action.bond = bond.key();
        action.issuer = bond.issuer;
        action.id = id;
        action.kind = kind;
        action.record_at = now;
        action.revision = bond.revision;
        action.portion_bps = portion_bps;
        action.price_bps = price_bps;
        action.period = period;
        action.bump = ctx.bumps.action;
        for i in 0..3 {
            let balance = bond.holders[i].balance;
            let (payment, retired) = entitlement(balance, bond.face, bond.coupon_bps, bond.frequency, kind, portion_bps, price_bps)?;
            action.balances[i] = balance;
            action.payments[i] = payment;
            action.retired[i] = retired;
            action.total = action.total.checked_add(payment).ok_or(PayError::Overflow)?;
        }
        require!(action.total > 0, PayError::Empty);
        // Snapshot is allowed before treasury funding; execution rechecks coverage.
        bond.next_action = bond.next_action.checked_add(1).ok_or(PayError::Overflow)?;
        Ok(())
    }

    pub fn execute(ctx: Context<Execute>) -> Result<()> {
        let bond = &ctx.accounts.bond;
        let action = &ctx.accounts.action;
        require!(!action.executed, PayError::Executed);
        require!(action.revision == bond.revision, PayError::Stale);
        require!(ctx.accounts.treasury.amount >= action.total, PayError::Funds);
        require!(action.kind != 0 || action.period > bond.last_coupon, PayError::Duplicate);
        let vaults = [&ctx.accounts.vault_0, &ctx.accounts.vault_1, &ctx.accounts.vault_2];
        let receivers = [&ctx.accounts.receiver_0, &ctx.accounts.receiver_1, &ctx.accounts.receiver_2];
        let issuer = bond.issuer;
        let bump = [bond.bump];
        let seeds: &[&[u8]] = &[b"bond", issuer.as_ref(), &bump];
        for i in 0..3 {
            require_keys_eq!(vaults[i].key(), bond.holders[i].vault, PayError::Accounts);
            require_keys_eq!(vaults[i].owner, bond.key(), PayError::Accounts);
            require_keys_eq!(vaults[i].mint, bond.mint, PayError::Accounts);
            require_keys_eq!(receivers[i].key(), bond.holders[i].settlement, PayError::Accounts);
            require_keys_eq!(receivers[i].owner, bond.holders[i].wallet, PayError::Accounts);
            require_keys_eq!(receivers[i].mint, bond.settlement_mint, PayError::Accounts);
            require!(vaults[i].amount == action.balances[i] && bond.holders[i].balance == action.balances[i], PayError::Stale);
            token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer { from: ctx.accounts.treasury.to_account_info(), to: receivers[i].to_account_info(), authority: ctx.accounts.bond.to_account_info() }, &[seeds]), action.payments[i])?;
            if action.retired[i] > 0 {
                token::burn(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Burn { mint: ctx.accounts.mint.to_account_info(), from: vaults[i].to_account_info(), authority: ctx.accounts.bond.to_account_info() }, &[seeds]), action.retired[i])?;
            }
        }
        let bond = &mut ctx.accounts.bond;
        let action = &mut ctx.accounts.action;
        for i in 0..3 { bond.holders[i].balance = bond.holders[i].balance.checked_sub(action.retired[i]).ok_or(PayError::Overflow)?; }
        if action.kind == 0 { bond.last_coupon = action.period; }
        bond.revision = bond.revision.checked_add(1).ok_or(PayError::Overflow)?;
        action.executed = true;
        emit!(ActionExecuted { bond: bond.key(), action: action.key(), kind: action.kind, total: action.total, retired: action.retired });
        Ok(())
    }
}

fn entitlement(balance: u64, face: u64, coupon: u16, frequency: u8, kind: u8, portion: u16, price: u16) -> Result<(u64, u64)> {
    let retired = match kind {
        0 => 0,
        1 => { let n = balance as u128 * portion as u128; require!(n % 10000 == 0, PayError::Fractional); u64::try_from(n / 10000).map_err(|_| PayError::Overflow)? },
        2 => balance,
        _ => return err!(PayError::Parameters),
    };
    let value = if kind == 0 { balance as u128 * face as u128 * coupon as u128 / (10000 * frequency as u128) } else { retired as u128 * face as u128 * if kind == 2 { 10000 } else { price as u128 } / 10000 };
    Ok((u64::try_from(value).map_err(|_| PayError::Overflow)?, retired))
}

// Gregorian civil date from Unix days; no client-supplied coupon-period trust.
fn coupon_period(timestamp: i64) -> u32 {
    let z = timestamp.div_euclid(86400) + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe/1460 + doe/36524 - doe/146096)/365;
    let mut year = yoe + era * 400;
    let doy = doe - (365*yoe + yoe/4 - yoe/100);
    let mp = (5*doy+2)/153;
    let month = mp + if mp < 10 {3} else {-9};
    if month <= 2 { year += 1; }
    (year*2 + if month <= 6 {0} else {1}) as u32
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)] pub issuer: Signer<'info>,
    #[account(init, payer=issuer, space=640, seeds=[b"bond", issuer.key().as_ref()], bump)] pub bond: Account<'info, Bond>,
    #[account(init, payer=issuer, seeds=[b"mint", bond.key().as_ref()], bump, mint::decimals=0, mint::authority=bond)] pub mint: Account<'info, Mint>,
    pub settlement_mint: Account<'info, Mint>,
    #[account(init, payer=issuer, seeds=[b"treasury", bond.key().as_ref()], bump, token::mint=settlement_mint, token::authority=bond)] pub treasury: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
#[instruction(index: u8)]
pub struct RegisterHolder<'info> {
    #[account(mut)] pub issuer: Signer<'info>,
    #[account(mut, has_one=issuer, has_one=mint, seeds=[b"bond", issuer.key().as_ref()], bump=bond.bump)] pub bond: Account<'info, Bond>,
    #[account(mut)] pub mint: Account<'info, Mint>,
    /// CHECK: Only used as the holder identity; receiver ownership is validated.
    pub holder: UncheckedAccount<'info>,
    #[account(token::mint=bond.settlement_mint, token::authority=holder)] pub receiver: Account<'info, TokenAccount>,
    #[account(init, payer=issuer, seeds=[b"vault", bond.key().as_ref(), &[index]], bump, token::mint=mint, token::authority=bond)] pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct Snapshot<'info> {
    #[account(mut)] pub issuer: Signer<'info>,
    #[account(mut, has_one=issuer, seeds=[b"bond", issuer.key().as_ref()], bump=bond.bump)] pub bond: Account<'info, Bond>,
    #[account(init, payer=issuer, space=256, seeds=[b"action", bond.key().as_ref(), &id.to_le_bytes()], bump)] pub action: Account<'info, Action>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Execute<'info> {
    pub issuer: Signer<'info>,
    #[account(mut, has_one=issuer, has_one=mint, has_one=treasury, seeds=[b"bond", issuer.key().as_ref()], bump=bond.bump)] pub bond: Account<'info, Bond>,
    #[account(mut, has_one=bond, has_one=issuer, seeds=[b"action", bond.key().as_ref(), &action.id.to_le_bytes()], bump=action.bump)] pub action: Account<'info, Action>,
    #[account(mut)] pub mint: Account<'info, Mint>,
    #[account(mut, token::mint=bond.settlement_mint, token::authority=bond)] pub treasury: Account<'info, TokenAccount>,
    #[account(mut)] pub vault_0: Account<'info, TokenAccount>,
    #[account(mut)] pub receiver_0: Account<'info, TokenAccount>,
    #[account(mut)] pub vault_1: Account<'info, TokenAccount>,
    #[account(mut)] pub receiver_1: Account<'info, TokenAccount>,
    #[account(mut)] pub vault_2: Account<'info, TokenAccount>,
    #[account(mut)] pub receiver_2: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[account]
#[derive(Default)]
pub struct Bond {
    pub issuer: Pubkey, pub mint: Pubkey, pub settlement_mint: Pubkey, pub treasury: Pubkey,
    pub face: u64, pub coupon_bps: u16, pub frequency: u8, pub maturity: i64, pub issued: i64,
    pub revision: u64, pub next_action: u64, pub last_coupon: u32,
    pub holders: [Holder;3], pub registered: u8, pub bump: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct Holder { pub wallet: Pubkey, pub vault: Pubkey, pub settlement: Pubkey, pub balance: u64 }
#[account]
pub struct Action {
    pub bond: Pubkey, pub issuer: Pubkey, pub id: u64, pub kind: u8, pub record_at: i64, pub revision: u64,
    pub portion_bps: u16, pub price_bps: u16, pub period: u32,
    pub balances: [u64;3], pub payments: [u64;3], pub retired: [u64;3],
    pub total: u64, pub executed: bool, pub bump: u8,
}
#[event]
pub struct ActionExecuted { pub bond: Pubkey, pub action: Pubkey, pub kind: u8, pub total: u64, pub retired: [u64;3] }
#[error_code]
pub enum PayError {
    #[msg("Invalid corporate action parameters")] Parameters,
    #[msg("Record date must match the current block date")] RecordDate,
    #[msg("Action is not available at this maturity date")] Maturity,
    #[msg("Duplicate holder or invalid/already paid coupon period")] Duplicate,
    #[msg("Partial redemption produces fractional bonds")] Fractional,
    #[msg("Settlement amount overflows u64")] Overflow,
    #[msg("No eligible bonds or zero settlement")] Empty,
    #[msg("Action already executed")] Executed,
    #[msg("Snapshot is stale; run a new simulation")] Stale,
    #[msg("Insufficient settlement treasury funds")] Funds,
    #[msg("Unexpected holder or token account")] Accounts,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn reference_coupon() { assert_eq!(entitlement(100,1_000_000_000,1000,2,0,0,0).unwrap(),(5_000_000_000,0)); }
    #[test] fn reference_partial() { assert_eq!(entitlement(100,1_000_000_000,1000,2,1,2000,10200).unwrap(),(20_400_000_000,20)); }
    #[test] fn full_redemption() { assert_eq!(entitlement(170,1_000_000_000,1000,2,2,0,0).unwrap(),(170_000_000_000,170)); }
    #[test] fn fractions_rejected() { assert!(entitlement(1,1_000_000_000,1000,2,1,2000,10200).is_err()); }
    #[test] fn half_years() { assert_eq!(coupon_period(1782864000),2026*2+1); assert_eq!(coupon_period(1767225600),2026*2); }
}
