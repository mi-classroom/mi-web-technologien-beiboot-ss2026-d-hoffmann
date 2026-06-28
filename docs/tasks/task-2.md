
> „Wann ist eine Bewegung eine Geste?"

## Beschreibung

Bevor Sie anfangen, Gesten zu implementieren, lohnt sich ein Schritt zurück: Welche Interaktionen brauchen Menschen eigentlich, und wie könnten diese mit Körperdaten übersetzt werden?

### Schritt 1: Gestenvokabular erarbeiten

Erstellen Sie ein Mapping typischer Interaktionsmuster auf mögliche Gesten und bewerten Sie, wie gut sich diese mit den Daten aus Issue #1 tatsächlich umsetzen lassen. Das Ergebnis ist keine fertige Implementierung, sondern eine fundierte Grundlage für die Entscheidungen in Schritt 2.

Wir erarbeiten einen ersten Entwurf dieser Tabelle gemeinsam in der Veranstaltung. Entwickeln Sie ihn anschließend für Ihren eigenen Anwendungskontext weiter.

| Interaktion | Mögliche Geste für den Nahbereich | Verfügbare Daten & Reliabilität | Mögliche Geste für den Fernbereich                               | Verfügbare Daten & Reliabilität |
| :-- | :-- | :-- | :-- | :-- |
| Gehe vor     | Ausgestreckter Zeigefinger nach rechts             | Koordinaten der Hand mindestens 1s im Fence | Arm zeigt nach rechts   | Koordinaten des Arms mindestens 1s im Fence |
| Gehe zurück | tbd | tbd  | tbd |
| | | | |



Ergänzen Sie die Tabelle um eigene Interaktionsmuster, die für Ihren Anwendungskontext relevant sind.

### Schritt 2: Prototypische Implementierung

Wählen Sie ein bis zwei Gesten aus Ihrer Tabelle aus und implementieren Sie diese prototypisch. Entwickeln Sie dafür einen ersten Algorithmus oder eine Heuristik, die aus den Rohkoordinaten eine diskrete, benannte Geste macht.

Fragen, die Sie dabei leiten sollten: Wie stabilisieren Sie das Signal? Wie verhindern Sie False Positives? Wie unterscheiden Sie eine Absicht von einer zufälligen Bewegung?

## Akzeptanzkriterien

- Die Mapping-Tabelle ist im Repo dokumentiert und enthält mindestens acht Interaktionsmuster
- Jede Zeile benennt eine mögliche Geste und bewertet die verfügbaren Daten und deren Reliabilität
- Sie haben ein bis zwei Gesten für die Implementierung ausgewählt und diese Wahl begründet dokumentiert
- Die gewählten Gesten werden zuverlässig erkannt – dokumentiert ist, wie sie algorithmisch detektiert werden (Schwellenwerte, Zeitfenster, Logik)
- Es gibt eine Demo, in der die erkannten Gesten visuell oder textuell sichtbar ausgegeben werden
- False-Positive-Verhalten und Stabilitätsprobleme sind ehrlich dokumentiert