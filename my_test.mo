within ;
package my_test
  model StoppageTest_dup
    "Test where the speed demand is read from the road, including stopping events"
    extends VeSyMA.Experiments.Templates.VehicleTest(
      redeclare VeSyMA.Drivers.ClosedLoop.ClosedLoop driver(
        redeclare replaceable
          VeSyMA.Drivers.Profiles.ExampleProfiles.LongitudinalClosedLoop
          driverProfile(
          longDistanceTable=false,
          longTimeLimits=false,
          stationaryToNeutralPark=true),
        stopLogic=true,
        speedTime=false,
        gradient=false),
      redeclare VeSyMA.Automotive.FrontWheelDrive.SmallFamilyMT vehicle(
        useVehicleStates=false,
        initialGear=4,
        v_start(displayUnit="m/s") = 13.5),
      redeclare VeSyMA.Roads.StaticRoads.GenericRoad road(
        animation=true,
        fileName=Modelica.Utilities.Files.loadResource(
            "modelica://VeSyMA/Resources/Data/RoadProfiles/RoadWithStops.mat"),

        activateStops=true,
        animateCones=true,
        r0Cones=[45,-2; 45,2; 100,-2; 100,2; 250,-2; 250,2]),
      redeclare VehicleInterfaces.Atmospheres.ConstantAtmosphere atmosphere);

    VeSyMA.Motion.Motions.OneDOF oneDOF(
      s_start=vehicle.s_start,
      w_start=vehicle.w_start,
      v_start=vehicle.v_start,
      h_start=vehicle.motion.h_start,
      roll_start=vehicle.motion.roll_start,
      pitch_start=vehicle.motion.pitch_start,
      yaw_start=vehicle.motion.yaw_start)
      annotation (Placement(transformation(extent={{60,-100},{80,-80}})));
  equation
    connect(oneDOF.chassisFrame, vehicle.chassisFrame) annotation (Line(
        points={{70,-80},{70,-68},{0,-68},{0,-40}},
        color={95,95,95},
        thickness=0.5));
    annotation (
      Documentation(revisions="<html>
<table cellspacing=\"0\" cellpadding=\"0\" border=\"0\"><tr>
<td><p><img src=\"modelica://VeSyMA/Images/claytex_logo_100x35px.gif\"/>&nbsp;&nbsp;&nbsp;</p></td>
<td><p><br><b>Copyright &copy; 2015-2022, Claytex Services Limited</b></p></td>
</tr>
</table>
</html>",
      info="<html>
<p>This is a test showing the stoppage within the road and driver.</p>
<p>The stopLogic is activated within the driver and activateStops within the road. </p>
<p>The stop distance and times are read from the road model.</p>
</html>"),
      experiment(
        StopTime=90,
        Interval=0.02,
        __Dymola_Algorithm="Radau"),
      __Dymola_experimentSetupOutput(events=false),
      __Dymola_Commands(file="modelica://VeSyMA/Scripts/Plot_powertrainVariables.mos"
          "Plot powertrain variables"));
  end StoppageTest_dup;
  annotation (uses(
      VeSyMA(version="2022.1"),
      Modelica(version="4.0.0"),
      VehicleInterfaces(version="2.0.1")));
end my_test;
