PRAGMA foreign_keys = ON;

ALTER TABLE listings ADD COLUMN image_url TEXT;
ALTER TABLE checkout_intents ADD COLUMN listing_title TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_intents ADD COLUMN listing_description TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_intents ADD COLUMN listing_image_url TEXT;
