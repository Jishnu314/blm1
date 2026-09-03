# public/ads

Pictures for the popup announcement that live **with the app** rather than in
Drive.

Drop a file in here — say `poster-oct.jpg` — and type just that name into the
admin's **Picture** box. Nothing else. Vite serves this folder at `/ads/` while
you are running `npm run dev`, and copies it into `dist/ads/` when you build, so
the same name works in both places.

Use this when the picture is going to stay for a while and you would rather it
was part of the app than fetched from Drive. Use the admin's **Choose a picture**
button instead when you just want to put something up now — that shrinks it,
keeps a copy in Drive, and fills the box in for you.

Keep them small. The popup shows at most 360 pixels wide on a phone, so anything
over about 1200 pixels wide is weight the agents pay for and cannot see. A JPEG
under 300 KB is plenty.
