Expression sheets for the desktop pet's chibi pose.

One sheet per outfit, a 4 x 4 grid of the same chibi with 16 different faces:
    AzurLane_bisimai.png   -> Main outfit
    christmas.png          -> Christmas outfit
    wedding.png            -> Wedding outfit

The app does not read these sheets directly. They are sliced into 16 cleaned, aligned
frames per outfit, saved as assets/<outfit>/moods/<mood>.png. The top-left cell becomes
neutral.png, which is the chibi itself; the pet swaps to the other frames as it reacts.

Frame names, reading each sheet left to right, top to bottom:
    main, wedding:  neutral smile laugh love / surprised shocked troubled angry /
                    thinking crying sigh sleepy / shy cool smug cheer
    christmas:      neutral smile laugh joy / angry pout surprised shocked /
                    troubled crying shy smug / flustered sleepy thinking stern

If a sheet is replaced, the frames have to be sliced again for the change to show.
