CREATE TABLE inventory (
  product_id text PRIMARY KEY,
  initial_stock integer NOT NULL CHECK (initial_stock > 0),
  stock integer NOT NULL CHECK (stock >= 0 AND stock <= initial_stock)
);
INSERT INTO inventory VALUES ('aurora-one', 500, 500);
CREATE TABLE system_state (id integer PRIMARY KEY CHECK (id=1), admission_initialized boolean NOT NULL DEFAULT false);
INSERT INTO system_state(id) VALUES (1);

CREATE TABLE attempts (
  attempt_id uuid PRIMARY KEY,
  customer_id uuid NOT NULL,
  product_id text NOT NULL REFERENCES inventory(product_id),
  status text NOT NULL CHECK (status IN ('confirmed', 'failed')),
  reason text,
  delivery_count integer NOT NULL DEFAULT 1 CHECK (delivery_count > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE orders (
  order_id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL UNIQUE REFERENCES attempts(attempt_id),
  customer_id uuid NOT NULL,
  product_id text NOT NULL REFERENCES inventory(product_id),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity = 1),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_created ON orders(customer_id, created_at DESC);

-- Use for evidence; each result must be checked against a settled run.
-- SELECT stock, (SELECT count(*) FROM orders) AS confirmed_orders,
--        stock + (SELECT count(*) FROM orders) = initial_stock AS conserved
-- FROM inventory WHERE product_id = 'aurora-one';
