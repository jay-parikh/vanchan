# Setting up sync (one time)

Sync is optional. Until these steps are done, `app/js/config.js` stays
`null` and the app shows no sync switch. Everything here is free: Supabase
free plan, Google sign-in, and no Netlify functions or credits.

You will need about 20 minutes. Keep two browser tabs open: Supabase and
Google Cloud.

## 1. Supabase project

1. Sign up at https://supabase.com with the new account.
2. **New project**, with these settings:
   - Name: `vanchan`
   - Region: Mumbai (closest)
   - Database password: a strong one (you won't need it in the app)
3. Wait for the project to finish starting. Then open **Project Settings → API
   Keys** and note these two values:
   - **Project URL**, like `https://abcdefghijkl.supabase.co`
   - **Publishable key**, starting `sb_publishable_`. Never use the secret /
     service_role key in the app.

## 2. Database

1. In Supabase, open **SQL Editor → New query**.
2. Paste all of `setup/vanchan-setup.sql` and press **Run**. It should say
   "Success. No rows returned".

## 3. Google sign-in

First copy the **Callback URL** from Supabase **Authentication → Sign In /
Providers → Google**. It looks like
`https://<project-ref>.supabase.co/auth/v1/callback`.

In Google Cloud (https://console.cloud.google.com), signed in with your
Google account:

1. With the project picker → **New project**, create `Vanchan`, then select it.
2. Open **APIs & Services → OAuth consent screen** (it may be called **Google
   Auth Platform**) → **Get started** and fill in:
   - App name: `Vanchan`
   - User support email: your email
   - Audience: **External**
   - Contact email: yours
   Tick the agreement, then **Create**.
3. **Branding → Authorized domains**: add `<project-ref>.supabase.co`, then save.
4. **Data Access → Add or remove scopes**: tick `.../auth/userinfo.email`,
   `.../auth/userinfo.profile` and `openid`, then **Update** and **Save**.
   These are basic scopes, so Google does not review the app.
5. **Clients → Create client** with these settings:
   - Type: **Web application**, name `Vanchan web`
   - Authorized JavaScript origins: `https://vanchan.netlify.app`
   - Authorized redirect URIs: the Callback URL copied above
   Press **Create**, then **copy the Client ID and Client secret right away**
   (or Download JSON). Google may show the secret only once. If it is lost,
   add a new secret on the client's page.
6. **Audience → Publish app**, so it shows "In production". Otherwise only
   listed test users can sign in.

Keep the Client secret private. It goes only into Supabase, never into the
app.

## 4. Connect Google to Supabase

1. In Supabase, open **Authentication → Sign In / Providers → Google**.
2. Switch it on, paste the Client ID (the field may be called "Client IDs") and
   the Client secret, and save.
3. Open **Authentication → URL Configuration** and set:
   - Site URL: `https://vanchan.netlify.app`
   - Redirect URLs (add each):
     - `https://vanchan.netlify.app`
     - `https://vanchan.netlify.app/**`
     - `https://*--vanchan.netlify.app/**` (free draft deploys for testing)
     - `http://localhost:8766` (only if testing on the server)

## Update for v12: highlights and notes

Version 12 syncs highlights, notes and pen marks. They need one more table.
In Supabase **SQL Editor → New query**, paste all of
`setup/vanchan-setup.sql` again and press **Run**. It is safe to run again: it
only adds what is missing. Until then everything else syncs, and Settings
says highlights and notes are waiting for this step.

## 5. Tell the app

Send me the Project URL and the publishable key, or put them in
`app/js/config.js` yourself:

```js
window.VANCHAN_SYNC = { url: 'https://<project-ref>.supabase.co', key: 'sb_publishable_…' };
```

Then run `./build.sh` and do the checks below.

## 6. Check on a free draft deploy first

A draft deploy costs no Netlify credits:

```
cd /home/frappe/frappe-bench/vanchan
~/node22/bin/netlify login          # once, opens a browser
~/node22/bin/netlify deploy --dir app   # prints a draft URL like https://<id>--vanchan.netlify.app
```

On the draft URL:

1. Turn on **Aa → Sync across devices** on the iPhone. Use the home-screen
   app made from the draft URL. Sign in with Google, and check that you come
   back into the app with "Sync is on".
2. Do the same on another device. The books should arrive, and saving a card
   on one device should show on the other after you reopen the app.

When both work, deploy `vanchan.zip` to production once (15 credits).

## Good to know

- A free Supabase project pauses after 7 days with no use. If you stop
  reading for a while, open the Supabase dashboard and press **Restore**.
- To delete a person's data, use Supabase **Authentication → Users → delete
  user**. Their rows go with them. Their files stay in Storage →
  `vanchan-books` → their folder, which you can delete there.
