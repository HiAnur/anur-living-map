CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE plans (user_id int REFERENCES users(id), period text NOT NULL, -- 'monthly' | 'annual'
                    amount_cents int NOT NULL, renews_on date);
CREATE TABLE invoices (id serial PRIMARY KEY, user_id int, amount_cents int, kind text, created_at timestamptz DEFAULT now());
