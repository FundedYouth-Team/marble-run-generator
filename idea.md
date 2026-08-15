I want to build a CAD like web app in react vite.
It will have a multi-mode.
2D Draft Mode and 3D Mode
In 2D Draft mode you are on draft style grid. You specifiy the inner diameter and out dimeter. Inner is the side where say a marble will roll. Outer is the wall thickness.
In this mode when looking at the tube size I want the ability to specify three variations of the tube: Half, 3/4th, and Closed. 3/4ths is like 70% with an opening on the top to see in the tube.
Then once the tube front face is defined. You select the type of object.
for the start only select "Straight Line"
Selecting this lets you define in Milimeters (mm) how long it should be.
I will need a way to clip the pieces together so there will need to snap in pieces.
Once these settings are defined I want a 3D CAD like view that lets me rotate, zoom, and pan around a space.
I also want a simulator to see a ball or marble roll down the piece.
