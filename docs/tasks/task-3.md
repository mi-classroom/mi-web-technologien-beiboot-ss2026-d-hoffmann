> „Was heißt es eigentlich, eine Library zu bauen?"

## Beschreibung

In Issue #2 haben Sie erste Gesten prototypisch implementiert. Jetzt geht es darum, aus diesen Einzellösungen etwas Systematisches zu machen: eine Gesture Library, die erweiterbar, testbar und für andere nutzbar ist.

### Was bedeutet „Library"?

Bevor Sie Code schreiben, setzen Sie sich mit der Frage auseinander, was eine gute Library ausmacht. Schauen Sie sich an, wie bestehende Gesture Libraries (z.B. Fingerpose, ZingTouch, Hammer.js) ihre API strukturieren:

- Wie werden neue Gesten definiert und registriert?
- Wie trennt die Library interne Erkennung von der öffentlichen Schnittstelle?
- Was muss ein Nutzer der Library wissen, was darf verborgen bleiben?
    

### Ihre Aufgabe

Erweitern Sie Ihre prototypischen Gesten aus Issue #2 zu einer strukturierten Library. Das bedeutet konkret:
- Gestenlogik kapseln: Die Erkennung einzelner Gesten soll unabhängig vom Rest Ihrer Anwendung funktionieren
- Erweiterbarkeit sicherstellen: Neue Gesten sollen hinzugefügt werden können, ohne bestehende zu brechen
- API definieren: Was ist öffentlich, was bleibt intern? Wie registriert man eine neue Geste?
- Dokumentation schreiben: Die Library soll von Dritten nutzbar sein, ohne den Quellcode lesen zu müssen
    
Implementieren Sie mindestens zwei weitere Gesten aus Ihrem Mapping (Issue #2) und integrieren Sie diese in Ihre Library-Struktur.

## Akzeptanzkriterien

- Die Gestenlogik ist in einer eigenständigen Library-Struktur gekapselt, getrennt von der Demo-Anwendung
- Mindestens vier Gesten (zwei aus Issue #2 plus zwei neue) sind implementiert und funktionieren
- Neue Gesten lassen sich hinzufügen, ohne bestehenden Code zu verändern
- Die öffentliche API ist dokumentiert: Wie instanziiert man die Library, wie registriert man Gesten, wie fragt man erkannte Gesten ab?
- Designentscheidungen sind in Decision Records festgehalten
    