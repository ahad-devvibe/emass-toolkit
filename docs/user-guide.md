# EMASS Toolkit — User Guide

The EMASS Toolkit is Nanoveu's private portal for EMASS SDKs and
documentation. This guide explains what you can do in the portal and how to
do it.

There are three kinds of accounts. Read the part that applies to you:

| Account | You use the portal to… | Read |
|---|---|---|
| **Customer** | Download EMASS SDKs and documentation | [Getting access](#1-getting-access), [For customers](#2-for-customers) |
| **Developer** | Prepare, publish and roll back versions | [Signing in as staff](#signing-in-as-staff), [For developers](#3-for-developers) |
| **Admin** | Approve new customers, manage domain rules, watch the dashboard | [Signing in as staff](#signing-in-as-staff), [For admins](#4-for-admins) |

---

## 1. Getting access

### Requesting an account

1. Open the portal and, on the sign-in page, select **Request access**.
2. Fill in the **Request Access** form: your work email, name, country,
   company, job title, and a few words on **What will you use EMASS for?**
3. Type the characters shown in the image. If you can't read them, load a new
   image.
4. Select **Request Access**. We email you a 6-digit code.
5. Enter the code and select **Verify email**. The code is valid for 10
   minutes. If it doesn't arrive, use **Resend code**.
6. **Choose a password** (at least 6 characters) and select **Create account**.

What happens next depends on your email address:

- **A company email:** your account is ready and you're signed in straight
  away.
- **A personal email** (Gmail, Outlook, Yahoo and similar): you'll see
  **Request received**. A Nanoveu admin reviews your request, and you'll get an
  email when you can sign in.
- **Some domains can't be used** to request access. You'll be told when you
  submit the form.

If you leave before finishing, just start again with the same email. We'll
send you a new code.

### Signing in

Enter your email and password on the sign-in page and select **Sign in**. You
stay signed in for up to two weeks on the same browser, unless you sign out.

### Signing in as staff

Developers and admins enter their password, then a **6-digit code** that we
email every time. Enter it and select **Verify and sign in**. Staff accounts
are set up by Nanoveu; you don't request one through the sign-up form.

### Forgot your password?

1. On the sign-in page, choose **Forgot password?** and enter your email.
2. If an account exists for that email, we send you a reset link. It works
   for 30 minutes.
3. Open the link, choose a new password, and sign in.

---

## 2. For customers

### Finding a product

After signing in you land on the **catalog**, which lists every EMASS product
available to you. Select a product to open its page.

### The product page

A product page shows the **latest version** by default, with:

- **Files:** the SDK for each platform (Windows, macOS, Ubuntu) and the
  documentation for that version.
- **Release notes:** what changed in this version.
- **This release:** the release date and supported platforms.

To get an older version, use the version picker at the top. Older versions are
marked **Archived**. They stay available, but the latest is recommended.

### Your first download: the licence

The first time you download anything, the **EMASS Software Licence** opens.
Read it, tick that you agree, and select **Accept and download**. You only do
this once for your account.

### Downloading a file

Select **Download** next to the file. The download starts straight away in
your browser.

### Checking your download

Each file has a **SHA-256 checksum**, a fingerprint of the exact file we
published. To check that your download is complete and unchanged:

1. Select the **ⓘ** (File details & checksum) icon next to the file.
2. Under **Verify after download**, copy the command for your system and run
   it in the folder where the file was saved.
3. The result must match the checksum shown. If it doesn't, download the file
   again.

### Emails you may get

- **A new version is available:** when we publish a new version of a product
  you've downloaded before.
- **A version has been withdrawn:** if we withdraw a version you downloaded,
  usually because of a problem. The email tells you which version to use
  instead. Please stop using the withdrawn one.

---

## 3. For developers

Your home page is **All Releases**, a list of every release and its status.
Developers manage releases from start to finish, and any developer can work on
any release. Admins can view releases but not change them.

### Creating a release

1. Select **New Release**.
2. **Drop your files** (or **Browse files**) at the top of the page. Upload
   starts immediately, two files at a time, and each file is saved as soon as
   it finishes. You can refresh the page without losing finished uploads.
3. Choose the **Product**.
4. Check the **Version.** If your SDK file names all carry the same version,
   the portal fills it in and locks it; to change it, change the files. If
   they don't agree, type the version yourself (for example `1.4.0`). It must
   be newer than anything already shipped for that product.
5. For each file, check its **type** (SDK or documentation) and, for SDKs, its
   **platform**. Each platform can have only one SDK.
6. Write the **Release notes** (Markdown, with a toolbar and a **Preview**).
7. Select **Save draft** (or Ctrl+S / ⌘S). Type, platform, version and notes
   are only kept once you save.

Keep the page open while files upload. Closing the tab or leaving the editor
stops uploads that haven't finished.

### File checks

Every file is checked before and after it uploads:

- **Blocked** (installers only): the file is refused if its version doesn't
  match the release, that version has already shipped, or the exact same file
  was uploaded before. Fix the file and drop it again.
- **Warnings** (usually documents): for example, a guide that mentions a
  different version or no version at all. You can still publish; you'll be
  asked to confirm the warnings, and they stay in the release's Activity.

If you drop an SDK for a platform that already has one, you'll be asked
whether to replace the existing file or change the new file's type.

### Deleting a draft

Drafts can be deleted with **Delete**. This removes the uploaded files too and can't be undone.

### Testing a build before it ships

You can download any file from the release page, even before it's published,
to test it. Download links for unpublished files last 5 minutes. Staff
downloads never count as customer downloads.

### Checking a release before publishing

In the editor, select **Save and continue** to open the release. Four cards
summarise a draft:

| Card | What it tells you |
|---|---|
| **Version** | The new version compared with the live one, and whether every file matches it. |
| **Checksums** | Whether any file is identical to one in the live version. |
| **Core SDKs** | How many of the three platforms (Windows, macOS, Ubuntu) have an SDK, and which are missing. |
| **Docs & release notes** | Whether documentation and release notes are included. |

Green is fine, amber is worth a look, red is likely wrong. The cards don't
stop you publishing; they help you decide.

### Publishing

Select **Publish v…**. You need a version and at least one file, and every
upload on the release has to be finished or cancelled. If someone else's upload
is still open, the dialog lists it with a **Cancel upload** button. If any file
has warnings, the dialog lists them and the button reads **Publish anyway**.
A progress bar shows the files being moved into place. While it runs the
release can't be edited. When it's done:

- the new version is **live** for customers;
- the previous version becomes **Archived** (still available as an older
  version);
- customers who downloaded an earlier version of the product get a **new
  version available** email.

If publishing fails, nothing has changed and you can try again.

### After publishing

A published release can't be changed, except for its notes: use **Edit
release notes**. To fix a problem in a shipped version, release a new version.

### Rolling back

Use **Roll back** if a published or archived version has a problem.

1. Enter an **Internal reason**. It's kept in the release history; customers
   never see it.
2. Optionally write a **Message to customers**. It's added to their email.
3. Select **Roll back**.

What happens:

- **Rolling back the live version** removes it from customers. The most recent
  earlier version becomes live again, if there is one.
- **Rolling back an archived version** removes it from the list of older
  versions. The live version is unchanged.
- **Everyone who downloaded the withdrawn version is emailed.** When the emails
  have gone out, the release's Activity shows how many customers were told.

A rollback can't be undone. To ship a fix, create a new version.

---

## 4. For admins

### Dashboard

Your home page is the **Dashboard**. It shows:

- **Active users**, **pending sign-ups**, **competitors blocked**, **sign-ups
  rejected**, and **downloads** (total and the last 30 days).
- **The sign-up queue:** the oldest sign-ups waiting for approval. Select
  **Review all** to see everything.

The page refreshes itself every 30 seconds.

### Approving sign-ups

People who sign up with a personal email wait in **Signup Requests**. For
each request you can see their details and what they plan to use EMASS for.

- **Approve:** the account becomes active and the person gets an email
  saying they can sign in.
- **Reject:** the account is blocked and the person gets an email, with your
  reason if you give one.

### Domain rules

**Domain Rules** controls what happens when someone signs up:

| List | Effect on new sign-ups |
|---|---|
| **Competitor** | Sign-ups are refused. |
| **Free mail** | Sign-ups wait for an admin's approval. |
| Any other domain | Sign-ups are active straight away. |

Select **Add email domain**, enter a domain such as `example.com` (you can
paste a full email address), and choose the list. Changes apply to **new**
sign-ups only; existing accounts are unaffected.

### Viewing releases

**All Releases** lists every release. You can open any of them, read its
Activity and download its files, but only developers can change, publish or
roll them back.

---

## 5. Release statuses

| Status | Meaning | Who sees it |
|---|---|---|
| **Draft** | Being prepared by the developers. | Staff |
| **Published** | The current version, live for customers. | Everyone |
| **Archived** | Replaced by a newer version, still available as an older version. | Everyone |
| **Rolled back** | Withdrawn from customers. | Staff |

---

## 6. Emails the portal sends

| Email                 | Sent to                                     | When                                     |
| --------------------- | ------------------------------------------- | ---------------------------------------- |
| Verification code     | Anyone requesting access                    | Step 1 of sign-up, or on **Resend code** |
| Welcome               | New customers with a company email          | When the account is created              |
| Request received      | New customers with a personal email         | When the account is waiting for approval |
| You can sign in       | Approved customers                          | When an admin approves them              |
| Request declined      | Rejected customers                          | When an admin rejects them               |
| Sign-in code          | Developers and admins                       | Every sign-in                            |
| Password reset link   | Anyone who asks                             | On **Forgot password?**                  |
| New version available | Customers who downloaded an earlier version | When a version is published              |
| Version withdrawn     | Customers who downloaded that version       | When a version is rolled back            |

---

## 7. Quick answers

**My code expired or didn't arrive.**
Codes last 10 minutes. Use **Resend code**, and check your spam folder.

**I signed up but can't sign in.**
If you used a personal email, your request may still be waiting for approval.
You'll get an email once it's approved.

**My password reset link doesn't work.**
Links last 30 minutes and work once. Use **Request a new link**.

**The download didn't start.**
Select **Download** again; every click creates a fresh link. A download link
works for one hour.

**The checksum doesn't match.**
The download was incomplete or damaged. Delete the file and download it again.

**I can't find an older version.**
Use the version picker on the product page. A version that was withdrawn no
longer appears.

**(Developers) My file was blocked.**
The message says why: the version doesn't match the release, that version has
already shipped, or the same file was uploaded before. Fix the file and drop
it again.

**(Developers) I can't edit my release.**
Only drafts can be edited, and not while they're being published. Published
releases only allow **Edit release notes**.

**Who do I contact?**
Use **Contact support** in the portal, or reach your Nanoveu contact.
