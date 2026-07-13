
> „Bauen Sie etwas mit Ihrer Library, als hätten Sie den Quellcode nie gesehen."

## Beschreibung

In Issue #3 haben Sie eine Library mit strukturierter API gebaut. Jetzt kommt die Bewährungsprobe: Wie gut funktioniert diese API, wenn man sie tatsächlich benutzt?

Bauen Sie eine kleine eigenständige Anwendung, die Ihre Gesture Library als externe Abhängigkeit behandelt. Die Anwendung darf ausschließlich über die öffentliche API mit der Library kommunizieren. Kein Zugriff auf interne Strukturen, keine Abkürzungen.

Das Thema der Anwendung ist frei wählbar. Ein paar Beispiele zur Orientierung:

- Einfache Präsentationssteuerung: vor/zurück per Geste
- Mini-Game, das auf Gesten reagiert
- Barrierefreie UI-Steuerung für eine statische Seite
- Interaktive Visualisierung, die auf Körperbewegungen reagiert

Wichtiger als die Anwendung selbst ist die Reflexion, die dabei entsteht. Was fehlte in der API? Was war unintuitiv? Was mussten Sie an der Library ändern oder ergänzen, damit die Anwendung funktioniert? Dokumentieren Sie diese Erkenntnisse gewissenhaft — das ist der eigentliche Lerngegenstand dieses Issues.

## Akzeptanzkriterien

- Die Demo-Anwendung ist lauffähig und nutzt ausschließlich die öffentliche API der Library
- Mindestens ein API-Problem ist identifiziert, beschrieben und durch eine Änderung an der Library behoben
- Die Änderungen an der Library sind in einem Decision Record begründet: Was war das Problem, welche Lösung wurde gewählt, welche Alternativen wurden verworfen?
- Die Anwendung ist lokal startbar und im Repo eingecheckt
