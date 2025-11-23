CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  order_type TEXT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  limit_price NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  executed_price NUMERIC,
  tx_hash TEXT,
  chosen_dex TEXT,
  chosen_quote JSONB,
  slippage_tolerance NUMERIC DEFAULT 0.01
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

